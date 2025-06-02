class Beats {
    /**
     * Creates an instance of Beats.
     * @param {AudioContext} audioContext - The shared Web Audio API context.
     * @param {number} [initialBpm=120] - The initial Beats Per Minute.
     */
    constructor(audioContext, initialBpm = 120) {
        if (!audioContext) {
            throw new Error("Beats requires an AudioContext to be provided.");
        }
        // --- Web Audio API ---
        this.audioContext = audioContext;
        // Create a gain node for the beat sound output
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.connect(this.audioContext.destination); // Connect to output

        // --- Configuration ---
        this.lookaheadMs = 25.0;
        this.scheduleAheadTimeSec = 0.1;
        this.beatSoundFrequency = 440; // Lower pitch for beat (A4)
        this.beatSoundDurationSec = 0.05;

        // --- State ---
        this.isPlaying = false;
        this.currentBpm = this._validateBpm(initialBpm);
        this._schedulerTimeoutId = null;
        this.nextBeatTime = 0.0;

        // --- Delayed BPM Change State ---
        this._bpmChangeTimeoutId = null;
        this._targetBpm = null;
        this._isBpmChangeScheduled = false;

        // --- Callback ---
        this.beatCallback = null; // Function to call on each beat

        console.log("Beats initialized with provided AudioContext.");
    }

    // --- Private Helper Methods ---

    _validateBpm(bpm) {
        const parsedBpm = parseInt(bpm, 10);
        if (isNaN(parsedBpm) || parsedBpm < 20 || parsedBpm > 300) {
            console.warn(`Beats: Invalid BPM: ${bpm}. Using 120 instead.`);
            return 120;
        }
        return parsedBpm;
    }

    // Note: _initAudioContext is removed as context is now provided

    _playBeatSound(time) {
        // Creates a short click/tick sound
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        // Connect oscillator -> gain -> masterGainNode (for external connection/analysis)
        oscillator.connect(gain);
        gain.connect(this.masterGainNode); // Connect to the instance's master gain

        oscillator.type = 'triangle'; // Triangle wave often sounds softer
        oscillator.frequency.setValueAtTime(this.beatSoundFrequency, time);
        gain.gain.setValueAtTime(0.5, time); // Start at half volume
        gain.gain.exponentialRampToValueAtTime(0.001, time + this.beatSoundDurationSec);

        oscillator.start(time);
        oscillator.stop(time + this.beatSoundDurationSec);
    }

    _scheduler() {
        if (!this.isPlaying || !this.audioContext) return;

        const secondsPerBeat = 60.0 / this.currentBpm;

        while (this.nextBeatTime < this.audioContext.currentTime + this.scheduleAheadTimeSec) {
            // 1. Play the beat sound at the scheduled time
            this._playBeatSound(this.nextBeatTime);

            // 2. Trigger the callback *at the scheduled time* using a timeout
            //    Calculate delay from now until the beat time
            const delayUntilBeat = Math.max(0, (this.nextBeatTime - this.audioContext.currentTime) * 1000);
            if (this.beatCallback) {
                // Use setTimeout for callback to align better with audio event timing
                setTimeout(() => {
                    // Check if still playing when callback executes
                    if (this.isPlaying && this.beatCallback) {
                         this.beatCallback();
                    }
                }, delayUntilBeat);
            }

            // 3. Advance to the next beat time
            this.nextBeatTime += secondsPerBeat;
        }

        // Re-schedule the scheduler function
        this._schedulerTimeoutId = setTimeout(() => this._scheduler(), this.lookaheadMs);
    }

    _performBpmChange(newBpm) {
        this.currentBpm = newBpm;
        this._isBpmChangeScheduled = false;
        this._targetBpm = null;
        this._bpmChangeTimeoutId = null;
        console.log(`Beats: BPM changed to ${this.currentBpm}`);
    }


    // --- Public Methods ---

    /**
     * Starts the metronome playback.
     * @returns {Promise<void>} Resolves when playback starts.
     */
    async play() {
        // AudioContext is assumed ready here, initialized by parent
        if (this.isPlaying) {
            console.log("Beats: Already playing.");
            return;
        }
        // Resume context just in case it was suspended externally
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                 console.error("Beats: Failed to resume context on play:", e);
                 return; // Don't start if context fails
            }
        }

        this.isPlaying = true;
        this.nextBeatTime = this.audioContext.currentTime + 0.1; // Start scheduling shortly
        this._scheduler(); // Start the scheduling loop
        console.log(`Beats: Metronome playing at ${this.currentBpm} BPM`);
    }

    /**
     * Pauses the metronome playback.
     */
    pause() {
        if (!this.isPlaying) {
            console.log("Beats: Already paused.");
            return;
        }
        this.isPlaying = false;
        clearTimeout(this._schedulerTimeoutId);
        this._schedulerTimeoutId = null;

        if (this._isBpmChangeScheduled) {
            clearTimeout(this._bpmChangeTimeoutId);
            this._bpmChangeTimeoutId = null;
            this._targetBpm = null;
            this._isBpmChangeScheduled = false;
            console.log("Beats: Pending BPM change cancelled due to pause.");
        }
        console.log("Beats: Metronome paused.");
    }

    /**
     * Sets the metronome's BPM.
     * @param {number} bpm - The desired Beats Per Minute (20-300).
     * @param {number} [delay=0] - Optional delay in seconds before the BPM change takes effect.
     */
    setBpm(bpm, delay = 0) {
        const newValidatedBpm = this._validateBpm(bpm);

        if (this._isBpmChangeScheduled) {
             clearTimeout(this._bpmChangeTimeoutId);
             this._bpmChangeTimeoutId = null;
             this._targetBpm = null;
             this._isBpmChangeScheduled = false;
             console.log("Beats: Cancelled previous scheduled BPM change.");
        }

        if (delay <= 0) {
            if (this.currentBpm !== newValidatedBpm) {
                 this._performBpmChange(newValidatedBpm);
            } else {
                 console.log(`Beats: BPM already set to ${newValidatedBpm}.`);
            }
        } else {
            this._targetBpm = newValidatedBpm;
            this._isBpmChangeScheduled = true;
            console.log(`Beats: Scheduling BPM change to ${this._targetBpm} in ${delay} seconds.`);
            this._bpmChangeTimeoutId = setTimeout(() => {
                if (this._isBpmChangeScheduled && this._targetBpm === newValidatedBpm) {
                    this._performBpmChange(this._targetBpm);
                } else {
                    console.log("Beats: Scheduled BPM change was cancelled before execution.");
                }
            }, delay * 1000);
        }
    }

     /**
     * Gets the current effective BPM.
     * @returns {number} The current BPM.
     */
    getCurrentBpm() {
        return this.currentBpm;
    }

     /**
     * Checks if the metronome is currently playing.
     * @returns {boolean} True if playing, false otherwise.
     */
    isCurrentlyPlaying() {
        return this.isPlaying;
    }

    /**
     * Sets the callback function to be executed on each beat.
     * @param {function | null} callback - The function to call, or null to remove.
     */
    setBeatCallback(callback) {
        if (typeof callback === 'function' || callback === null) {
             this.beatCallback = callback;
             console.log("Beats: Beat callback updated.");
        } else {
             console.warn("Beats: Invalid beat callback provided. Must be a function or null.");
        }
    }

    /**
     * Gets the main output node (GainNode) of this Beats instance.
     * @returns {GainNode | null} The master gain node for beat sounds.
     */
    getOutputNode() {
        return this.masterGainNode;
    }

    /**
     * Cleans up resources used by this Beats instance.
     * Does NOT close the provided AudioContext.
     */
    destroy() {
        console.log("Beats: Destroying instance...");
        this.pause(); // Ensure scheduler is stopped and pending changes cancelled
        this.beatCallback = null; // Remove callback reference

        // Disconnect the master gain node
        if (this.masterGainNode) {
            this.masterGainNode.disconnect();
            this.masterGainNode = null;
        }
        // Other references will be garbage collected
        console.log("Beats: Instance destroyed.");
    }
}

// Export the class if using modules
export default Beats;
