class PaceFlow {
  /**
   * Creates an instance of PaceFlow.
   * @param {AudioContext} audioContext - The shared Web Audio API context.
   */
  constructor(audioContext) {
      if (!audioContext) {
          throw new Error("PaceFlow requires an AudioContext to be provided.");
      }
      // --- Web Audio API ---
      this._audioContext = audioContext;
      this._masterGain = this._audioContext.createGain(); // 主音量控制节点
      this._masterGain.connect(this._audioContext.destination); // 连接到最终输出

      // --- State ---
      this.currentMusic = null; // { element: AudioBufferSourceNode, gainNode: GainNode, bpm: number, buffer: AudioBuffer } | null
      this.nextMusic = null;    // { element: AudioBufferSourceNode, gainNode: GainNode, bpm: number, buffer: AudioBuffer } | null
      this.isPlaying = false;   // 仅表示是否有音乐在播放或转换中，PaceFlow 本身没有独立的播放/暂停状态
      this.isTransitioning = false;
      this._transitionTimeoutId = null; // 转换结束的 Timeout ID
      this._gracePeriodTimeoutId = null; // 宽限期结束的 Timeout ID

      // --- Caching/Concurrency ---
      this.latestPendingBpm = null; // 转换/宽限期间缓存的最新 BPM 请求

      // --- Configuration ---
      this.transitionDurationSec = 5.0; // 交叉淡入淡出时间
      this.postTransitionGraceSec = 5.0; // 转换后的宽限时间

      console.log("PaceFlow initialized with provided AudioContext.");
  }

  // --- Private Helper Methods ---

  /** Abstracted music loading - currently uses URL concatenation */
  async _loadMusic(bpm) {
      // AudioContext is now guaranteed by constructor
      const url = new URL(bpm + '.wav', document.URL).href;
      console.log(`PaceFlow: Loading music for BPM ${bpm} from: ${url}`);
      try {
          const response = await fetch(url);
          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status} for ${url}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          // Use the provided AudioContext
          const audioBuffer = await this._audioContext.decodeAudioData(arrayBuffer);
          console.log(`PaceFlow: Successfully loaded and decoded audio for BPM ${bpm}`);
          return audioBuffer;
      } catch (error) {
          console.error(`PaceFlow: Error loading music for BPM ${bpm}:`, error);
          throw error;
      }
  }

  /** Creates playable audio source and gain node */
  _createAudioSource(audioBuffer, bpm) {
      // AudioContext is guaranteed
      const sourceNode = this._audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.loop = true;

      const gainNode = this._audioContext.createGain();
      gainNode.gain.setValueAtTime(0, this._audioContext.currentTime); // Start silent

      sourceNode.connect(gainNode);
      gainNode.connect(this._masterGain); // Connect to PaceFlow's master gain

      return {
          element: sourceNode,
          gainNode: gainNode,
          bpm: bpm,
          buffer: audioBuffer
      };
  }

  /** Starts playback of a music object */
  _startPlayback(musicData, startTime = 0, initialGain = 1) {
      if (!musicData || !this._audioContext) return;
      const now = this._audioContext.currentTime;
      // Ensure gain is set correctly *before* starting playback visually
      musicData.gainNode.gain.setValueAtTime(initialGain, now);
      try {
          musicData.element.start(startTime); // startTime is relative to context creation
          this.isPlaying = true; // Mark as playing
          console.log(`PaceFlow: Started playback for BPM ${musicData.bpm}`);
      } catch (e) {
          // Handle cases where start() might be called on an already started node (e.g., during rapid changes)
          console.warn(`PaceFlow: Could not start playback for BPM ${musicData.bpm} (possibly already started): ${e.message}`);
      }
  }

  /** Cleans up resources for a music object */
  _cleanupMusicData(musicData) {
       if (!musicData) return;
       try {
          // Attempt to stop the source node if it hasn't been stopped already
          // Note: Calling stop() multiple times is generally safe.
          try {
               musicData.element.stop(0); // Stop immediately if not already stopped
          } catch(e) {
               // Ignore errors if already stopped
          }
          musicData.element.disconnect();
          musicData.gainNode.disconnect();
          console.log(`PaceFlow: Cleaned up nodes for BPM ${musicData.bpm}`);
      } catch (e) {
          console.warn(`PaceFlow: Minor error during cleanup for BPM ${musicData.bpm}:`, e.message);
      }
  }


  /** Performs the crossfade between two music tracks */
  _crossfade(fadeOutMusic, fadeInMusic) {
      if (!this._audioContext || !fadeOutMusic || !fadeInMusic) return;

      const now = this._audioContext.currentTime;
      const fadeEndTime = now + this.transitionDurationSec;

      console.log(`PaceFlow: Starting crossfade: ${fadeOutMusic.bpm} BPM -> ${fadeInMusic.bpm} BPM over ${this.transitionDurationSec}s`);
      this.isTransitioning = true;
      this.isPlaying = true; // Still considered playing during transition

      // Schedule fade out
      fadeOutMusic.gainNode.gain.cancelScheduledValues(now);
      fadeOutMusic.gainNode.gain.setValueAtTime(fadeOutMusic.gainNode.gain.value, now);
      fadeOutMusic.gainNode.gain.linearRampToValueAtTime(0.0001, fadeEndTime);

      // Schedule fade in
      fadeInMusic.gainNode.gain.cancelScheduledValues(now);
      fadeInMusic.gainNode.gain.setValueAtTime(0, now);
      fadeInMusic.gainNode.gain.linearRampToValueAtTime(1.0, fadeEndTime);
      this._startPlayback(fadeInMusic, 0, 0); // Start source now, gain=0

      // Schedule the old track to stop *after* the fade is complete
      try {
          fadeOutMusic.element.stop(fadeEndTime);
      } catch (e) {
          console.warn(`PaceFlow: Could not schedule stop for BPM ${fadeOutMusic.bpm}: ${e.message}`);
      }

      // Set timeout to complete the transition state change
      clearTimeout(this._transitionTimeoutId);
      this._transitionTimeoutId = setTimeout(() => {
          this._completeTransition(fadeOutMusic);
      }, this.transitionDurationSec * 1000 + 50); // Add small buffer
  }

  /** Finalizes the transition, cleans up, and sets grace period */
  _completeTransition(musicToCleanup) {
      console.log(`PaceFlow: Crossfade completed. Current BPM is now ${this.nextMusic?.bpm}`);
      this.isTransitioning = false;
      this._transitionTimeoutId = null;

      // Cleanup old music resources (ensure stop was called)
      this._cleanupMusicData(musicToCleanup);

      // Promote nextMusic to currentMusic
      this.currentMusic = this.nextMusic;
      this.nextMusic = null;

      if (!this.currentMusic) {
           console.warn("PaceFlow: Transition completed, but no current music was set.");
           this.isPlaying = false; // Nothing is playing now
           return;
      }
      // Still playing the new currentMusic
      this.isPlaying = true;

      // Start grace period
      console.log(`PaceFlow: Starting ${this.postTransitionGraceSec}s grace period.`);
      clearTimeout(this._gracePeriodTimeoutId);
      this._gracePeriodTimeoutId = setTimeout(() => {
          this._handlePostGracePeriod();
      }, this.postTransitionGraceSec * 1000);
  }

  /** Checks and processes cached BPM request after grace period */
  _handlePostGracePeriod() {
      this._gracePeriodTimeoutId = null;
      console.log("PaceFlow: Grace period ended.");
      if (this.latestPendingBpm !== null) {
          console.log(`PaceFlow: Processing cached BPM request: ${this.latestPendingBpm}`);
          const bpmToProcess = this.latestPendingBpm;
          this.latestPendingBpm = null;
          // Use async call but don't necessarily wait for it here
          this.setBpm(bpmToProcess).catch(err => {
               console.error("PaceFlow: Error processing cached BPM:", err)
          });
      } else {
          console.log("PaceFlow: No cached BPM request to process.");
      }
  }

  // --- Public Methods ---

  /**
   * Sets the target BPM, handling transitions and caching.
   * @param {number} bpm - The desired Beats Per Minute.
   * @returns {Promise<void>} Resolves when the process starts, rejects on critical errors.
   */
  async setBpm(bpm) {
      // AudioContext is guaranteed by constructor
      bpm = Math.round(bpm);
      console.log(`PaceFlow: setBpm(${bpm}) called.`);
      const isInGracePeriod = this._gracePeriodTimeoutId !== null;

      if (this.isTransitioning || isInGracePeriod) {
          console.log(`PaceFlow: Request for BPM ${bpm} received during active transition or grace period. Caching.`);
          this.latestPendingBpm = bpm;
          return Promise.resolve(); // Indicate acceptance (cached)
      }

      console.log(`PaceFlow: Processing BPM ${bpm} immediately.`);
      this.latestPendingBpm = null;

      if (this.currentMusic && this.currentMusic.bpm === bpm) {
          console.log(`PaceFlow: Already playing BPM ${bpm}. No change needed.`);
          // Ensure playback is active if somehow stopped
          if (!this.isPlaying) this._startPlayback(this.currentMusic, 0, 1);
          return Promise.resolve();
      }

      let audioBuffer;
      try {
          audioBuffer = await this._loadMusic(bpm);
      } catch (error) {
          console.error(`PaceFlow: Failed to load music for BPM ${bpm}. Cannot proceed.`, error);
           // Keep current music playing if possible
           if(this.currentMusic && !this.isPlaying){
               this._startPlayback(this.currentMusic, 0, 1);
           }
          return Promise.reject(error);
      }

      const newMusic = this._createAudioSource(audioBuffer, bpm);
      if (!newMusic) {
           console.error("PaceFlow: Failed to create audio source. Cannot proceed.");
           return Promise.reject(new Error("Failed to create audio source."));
      }

      if (!this.currentMusic) {
          console.log(`PaceFlow: Loading first track: BPM ${bpm}`);
          this.currentMusic = newMusic;
          this._startPlayback(this.currentMusic, 0, 1);
      } else {
          if(this.nextMusic){
              console.warn("PaceFlow: Unexpected 'nextMusic' found, cleaning up before new transition.");
              this._cleanupMusicData(this.nextMusic);
              this.nextMusic = null;
          }
          this.nextMusic = newMusic;
          this._crossfade(this.currentMusic, this.nextMusic);
      }
      return Promise.resolve();
  }

  /**
   * Stops all current playback, transitions, and clears pending actions.
   */
   stopAll() {
       console.log("PaceFlow: Stopping all playback...");
       this.isPlaying = false;
       this.isTransitioning = false;
       this.latestPendingBpm = null;

       clearTimeout(this._transitionTimeoutId);
       this._transitionTimeoutId = null;
       clearTimeout(this._gracePeriodTimeoutId);
       this._gracePeriodTimeoutId = null;

       if(this.currentMusic){
           this._cleanupMusicData(this.currentMusic);
           this.currentMusic = null;
       }
        if(this.nextMusic){
           this._cleanupMusicData(this.nextMusic);
           this.nextMusic = null;
       }
       console.log("PaceFlow: Playback stopped.");
   }

   /**
    * Gets the main output node (GainNode) of this PaceFlow instance.
    * @returns {GainNode | null} The master gain node.
    */
   getOutputNode() {
       return this._masterGain;
   }

  /**
   * Cleans up resources used by this PaceFlow instance.
   * Does NOT close the provided AudioContext.
   */
  destroy() {
      console.log("PaceFlow: Destroying instance...");
      this.stopAll(); // Stop everything first
      // Disconnect the master gain from destination
      if (this._masterGain) {
          this._masterGain.disconnect();
          this._masterGain = null; // Release reference
      }
      // References to audioContext, currentMusic, nextMusic will be garbage collected
      console.log("PaceFlow: Instance destroyed.");
  }
}

// Export the class if using modules
export default PaceFlow;
