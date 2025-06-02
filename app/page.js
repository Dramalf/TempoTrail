"use client"
import React, { useState, useRef, useCallback, useEffect } from 'react';
// Ensure imports are from the correct file paths
import AudioVisualizerNinja from './AudioVisualizerNinja';
import PaceFlow from './Paceflow'; // Import modified PaceFlow class
import Beats from './Beats';     // Import modified Beats class
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'; // Added for charting
import { fetchDemoDataPointFromAPI, fetchPredictionDataFromAPI } from './request'; // Import new request functions

const SPEED_SCALE=5;
// --- API Configuration ---
// const BASE_URL = "http://localhost:8080"; // Moved to request.js
// const DEMO_DATA_ENDPOINT = `${BASE_URL}/demo_data`; // Moved to request.js
// const DEMO_PREDICT_ENDPOINT = `${BASE_URL}/demo_predict`; // Moved to request.js

// --- Data Configuration ---
const MAX_DATA_POINTS_HISTORY = 50; // Max historical data points for local storage (if needed for chart)
const COEFFICIENT_SPEED_TO_CADENCE = 2.5; // Adjust: e.g., (steps/sec) / (m/s)

// --- Main Demo Component ---
function NinjaDemoPage() {
    // --- Existing State ---
    const [isPlaying, setIsPlaying] = useState(false); // True if data fetching loops are active
    const [displayBpm, setDisplayBpm] = useState(150); // BPM for UI and manual PaceFlow control
    const [isInitialized, setIsInitialized] = useState(false); // Has audio been initialized?
    const [statusMessage, setStatusMessage] = useState("Click Start to begin");

    // --- New State for API Data & UI Display ---
    const [currentActualHeartRate, setCurrentActualHeartRate] = useState(0);
    const [currentActualSpeed, setCurrentActualSpeed] = useState(0);
    const [currentTargetCadence, setCurrentTargetCadence] = useState(0); // From prediction
    const [currentMusicBPM, setCurrentMusicBPM] = useState(0); // Derived from target cadence for Beats
    const [speedHistory, setSpeedHistory] = useState([]); // New state for speed chart data

    // --- Refs ---
    const audioContextRef = useRef(null);
    const analyserNodeRef = useRef(null);
    const paceFlowRef = useRef(null);
    const beatsRef = useRef(null);

    // --- New Refs for API polling logic ---
    const currentTForDemoApiRef = useRef(1);
    const currentPredictIdxRef = useRef(3); // Initial prediction index
    const timeForNextPredictionCallRef = useRef(Date.now());
    const isFetchingPredictionRef = useRef(false);
    const isFetchingDemoDataRef = useRef(false);
    const initialIdxSearchAttemptsRef = useRef(0);
    const MAX_INITIAL_IDX_SEARCH_ATTEMPTS = 100;
    const nextPreditionTsRef = useRef(30);
    const demoDataIntervalIdRef = useRef(null);
    const predictionLoopTimeoutIdRef = useRef(null);

    // --- Historical data (optional, for potential future charting) ---
    // const [demoTimestamps, setDemoTimestamps] = useState([]);
    // const [demoHeartRates, setDemoHeartRates] = useState([]);
    // const [demoSpeeds, setDemoSpeeds] = useState([]);

    // Add new state for the audio component toggles
    const [playBeats, setPlayBeats] = useState(true);
    const [playPaceFlow, setPlayPaceFlow] = useState(true);

    // --- Initialize Audio Environment (Largely unchanged) ---
    const initializeAudio = async () => {
        if (isInitialized) return true;
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            if (context.state === 'suspended') await context.resume();
            audioContextRef.current = context;

            const analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            analyserNodeRef.current = analyser;
            analyser.connect(context.destination);

            const pfInstance = new PaceFlow(context);
            paceFlowRef.current = pfInstance;

            const bInstance = new Beats(context, displayBpm); // Initial BPM from slider
            beatsRef.current = bInstance;

            const paceFlowOutput = pfInstance.getOutputNode();
            if (paceFlowOutput) paceFlowOutput.connect(analyser);
            else console.warn("PaceFlow output not available for analyser.");

            const beatsOutput = bInstance.getOutputNode();
            if (beatsOutput) beatsOutput.connect(analyser);
            else console.warn("Beats output not available for analyser.");
            beatsRef.current.setBpm(displayBpm, 0);
            
            // Only start playing if the respective toggle is enabled
            if (playBeats) {
                beatsRef.current.play();
            }

            setIsInitialized(true);
            setStatusMessage("Audio initialized. Ready to start.");
            console.log("Audio environment initialized.");
            return true;
        } catch (error) {
            console.error("Audio initialization failed:", error);
            setStatusMessage(`Audio initialization error: ${error.message}`);
            setIsInitialized(false);
            // Cleanup
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
            audioContextRef.current = null;
            analyserNodeRef.current = null;
            paceFlowRef.current = null;
            beatsRef.current = null;
            return false;
        }
    };

    // Toggles between play and pause states for data fetching
    const togglePlayPause = async () => {
        await initializeAudio();
        setIsPlaying(!isPlaying);
        if (isPlaying) {
            
        } else {
            // startDataFetchingLoops().catch(err => {
            //     console.error("Toggle Play/Start Error:", err);
            //     setStatusMessage(`Error starting: ${err.message}`);
            //     setIsPlaying(false); // Ensure consistent state
            // });
            // predictionLoop();
        }
    };

    // Handles BPM slider changes (primarily for PaceFlow if not overridden by prediction)
    const handleBpmChange = (event) => {
        const newBpm = parseInt(event.target.value, 10);
        // Basic validation, can be expanded
        if (newBpm < 60 || newBpm > 220) return;

        setDisplayBpm(newBpm);

        if (isInitialized && paceFlowRef.current) {
            setStatusMessage(`Manual BPM for PaceFlow set to: ${newBpm}`);
            paceFlowRef.current.setBpm(roundUpToNearestFive(newBpm)).catch(err => {
                 console.error("PaceFlow setBpm (manual) failed:", err);
                 setStatusMessage(`PaceFlow BPM error: ${err.message}`);
            });
        }
        // If not playing with predictions, or if you want slider to also affect Beats when paused:
        if (!isPlaying && beatsRef.current && currentMusicBPM === 0) {
             beatsRef.current.setBpm(newBpm, 0);
        }
    };

    // Add handlers for checkbox changes
    const handleBeatsToggle = (event) => {
        const shouldPlay = event.target.checked;
        setPlayBeats(shouldPlay);
        
        if (isInitialized && beatsRef.current) {
            if (shouldPlay) {
                beatsRef.current.play();
                setStatusMessage("Beats playback enabled");
            } else {
                beatsRef.current.pause();
                setStatusMessage("Beats playback disabled");
            }
        }
    };
    
    const handlePaceFlowToggle = (event) => {
        const shouldPlay = event.target.checked;
        setPlayPaceFlow(shouldPlay);
        
        if (isInitialized && paceFlowRef.current) {
            if (shouldPlay) {
                paceFlowRef.current.play();
                setStatusMessage("PaceFlow playback enabled");
            } else {
                paceFlowRef.current.stopAll();
                setStatusMessage("PaceFlow playback disabled");
            }
        }
    };

    // --- Effects ---
    // Main effect for starting prediction loop when isPlaying becomes true
    useEffect(() => {
        let ot=0;
        if (isPlaying) {
            clearInterval(demoDataIntervalIdRef.current);
            clearInterval(predictionLoopTimeoutIdRef.current);
            demoDataIntervalIdRef.current = setInterval(()=>{
                
                fetchDemoDataPointFromAPI(currentTForDemoApiRef.current).then((data)=>{
                    try {
                        const {data:{speed, heart_rate,ts}} = data;
                        setCurrentActualSpeed(speed);
                        setCurrentActualHeartRate(heart_rate);
                        currentTForDemoApiRef.current += 1;
                        ot=ts;
                        setSpeedHistory(prevHistory => [...prevHistory, {time: currentTForDemoApiRef.current, speed: speed}]);  
                    } catch (error) {
                        console.error("Error parsing demo data:", error);
                    }
               });
            }, 1000/SPEED_SCALE);
            predictionLoopTimeoutIdRef.current = setInterval(()=>{
                if (ot<nextPreditionTsRef.current) return;
                if(currentPredictIdxRef.current<6) {
                    currentPredictIdxRef.current=6;
                }
                fetchPredictionDataFromAPI(currentPredictIdxRef.current).then((data)=>{
                    console.log("Prediction data fetched", JSON.stringify(data));

                    const {data:{predicted_speed,next_idx,current_input_end_origin_timestamp: input_end_ts,next_idx_origin_timestamp: next_idx_ts}} = data;
                    let newBpm = roundUpToNearestFive(Math.round(170 + 5 * (predicted_speed - 14)));
                    setCurrentTargetCadence(newBpm);
                    setCurrentMusicBPM(newBpm);
                    console.log("newBpm", newBpm,isInitialized,paceFlowRef.current);  
                    if (isInitialized && paceFlowRef.current && playPaceFlow) {
                        setStatusMessage(`Manual BPM for PaceFlow set to: ${newBpm}`);
                        paceFlowRef.current.setBpm(newBpm).catch(err => {
                             console.error("PaceFlow setBpm (manual) failed:", err);
                             setStatusMessage(`PaceFlow BPM error: ${err.message}`);
                        });
                    }
                    if (beatsRef.current && playBeats) {
                        beatsRef.current.setBpm(newBpm, 0);
                    }
                    setDisplayBpm(newBpm);
                    currentPredictIdxRef.current=next_idx;
                    nextPreditionTsRef.current=next_idx_ts;
                });
            }, 1000/SPEED_SCALE);
        } else {
            clearInterval(demoDataIntervalIdRef.current);
            clearInterval(predictionLoopTimeoutIdRef.current);

        }
    }, [isPlaying]); // predictionLoop removed from dependencies

    // Cleanup Effect for AudioContext and other resources
    useEffect(() => {
        return () => {
            console.log("Unmounting NinjaDemoPage, performing cleanup...");
            // stopDataFetchingLoops(); // Call the latest version of stopDataFetchingLoops

            if (beatsRef.current) beatsRef.current.destroy();
            if (paceFlowRef.current) paceFlowRef.current.destroy();
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().then(() => console.log("AudioContext closed."));
            }
            audioContextRef.current = null;
            analyserNodeRef.current = null;
            paceFlowRef.current = null;
            beatsRef.current = null;
        };
    }, []); // stopDataFetchingLoops removed from dependencies, effect runs once on mount for unmount cleanup

    // --- Canvas Dimensions (for key prop) ---
    const canvasWidth = 400;
    const canvasHeight = 150; // Adjusted height for visualizer

    // --- Helper for Color Coding (Example) ---
    const getHeartRateZoneStyle = (hr) => {
        if (hr === 0) return { color: 'grey' }; // Default
        if (hr < 100) return { color: 'lightblue', fontWeight: 'bold' }; // Zone 1
        if (hr < 140) return { color: 'green', fontWeight: 'bold' };   // Zone 2 (Target)
        if (hr < 160) return { color: 'orange', fontWeight: 'bold' };  // Zone 3
        return { color: 'red', fontWeight: 'bold' }; // Zone 4+
    };
    const getCadenceStyle = (actualCadence, targetCadence) => {
        if (targetCadence === 0) return { color: 'grey'};
        const diff = Math.abs(actualCadence - targetCadence);
        if (diff < 5) return { color: 'green', fontWeight: 'bold' }; // On target
        if (diff < 15) return { color: 'orange', fontWeight: 'bold' }; // Near target
        return { color: 'red', fontWeight: 'bold' }; // Off target
        // This is conceptual, actual cadence isn't directly available from demo_data
        // You might compare current speed to a speed that implies target cadence
    };


    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px', margin: 'auto' }}>
            <h1>Interactive Audio Demo</h1>

            {/* Control Area */}
            <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap', padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }}>
                <button
                    onClick={togglePlayPause}
                    disabled={!isInitialized && !isPlaying && statusMessage.includes('error')}
                    style={{ padding: '10px 15px', fontSize: '1em', minWidth: '100px' }}
                >
                    {isPlaying ? 'Pause' : 'Start'}
                </button>
                <div>
                    <label htmlFor="bpmSlider">Manual PaceFlow BPM: {displayBpm}</label>
                    <input
                        type="range"
                        id="bpmSlider"
                        min="60"
                        max="220"
                        step="5"
                        value={displayBpm}
                        onChange={handleBpmChange}
                        style={{ marginLeft: '10px', verticalAlign: 'middle', minWidth: '180px' }}
                        disabled={isPlaying && currentMusicBPM > 0} // Disable if prediction is driving BPM
                    />
                </div>
                
                {/* Audio Component Toggles */}
                <div style={{ display: 'flex', gap: '15px', marginLeft: 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={playBeats}
                            onChange={handleBeatsToggle}
                            style={{ marginRight: '5px' }}
                        />
                        Play Beats
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={playPaceFlow}
                            onChange={handlePaceFlowToggle}
                            style={{ marginRight: '5px' }}
                        />
                        Play PaceFlow
                    </label>
                </div>
            </div>

            {/* Data Display Area */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '20px', padding: '10px', border: '1px solid #eee', borderRadius: '8px' }}>
                <div>
                    <h4>Heart Rate</h4>
                    <p style={{ fontSize: '1.5em', ...getHeartRateZoneStyle(currentActualHeartRate) }}>
                        {currentActualHeartRate.toFixed(0)} <span style={{fontSize: '0.7em'}}>bpm</span>
                    </p>
                </div>
                <div>
                    <h4>Speed (Live)</h4>
                    <p style={{ fontSize: '1.5em', color: '#333' }}>
                        {/* This displays currentActualSpeed, which might be from demo_data (m/s) or prediction (km/h?)
                            The label says km/h. Ensure consistency or clarify units.
                            If currentActualSpeed is m/s from demo_data, (currentActualSpeed * 3.6).toFixed(2) would be km/h.
                        */}
                        {currentActualSpeed.toFixed(2)} <span style={{fontSize: '0.7em'}}>km/h (?)</span>
                    </p>
                </div>
                <div>
                    <h4>Target Cadence</h4>
                    <p style={{ fontSize: '1.5em', color: currentTargetCadence > 0 ? 'darkblue' : 'grey' }}>
                        {currentTargetCadence.toFixed(0)} <span style={{fontSize: '0.7em'}}>SPM</span>
                    </p>
                </div>
                <div>
                    <h4>Music / Beats BPM</h4>
                    <p style={{ fontSize: '1.5em', color: currentMusicBPM > 0 ? 'purple' : 'grey' }}>
                        {currentMusicBPM > 0 ? currentMusicBPM : displayBpm} <span style={{fontSize: '0.7em'}}>BPM</span>
                    </p>
                </div>
            </div>

            {/* Speed Chart Area */}
            {isInitialized && speedHistory.length > 0 && (
                <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }}>
                    <h4>Speed Over Time (from Demo Data)</h4>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart
                            data={speedHistory}
                            margin={{
                                top: 5, right: 30, left: 20, bottom: 5,
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" label={{ value: "Time (Sequence)", position: 'insideBottomRight', offset: -5 }} />
                            <YAxis label={{ value: 'Speed (m/s)', angle: -90, position: 'insideLeft' }} />
                            <Tooltip formatter={(value) => `${parseFloat(value).toFixed(2)} m/s`} />
                            <Legend />
                            <Line type="monotone" dataKey="speed" stroke="#8884d8" activeDot={{ r: 8 }} name="Demo Speed" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Visualizer Area - Unchanged */}
            {isInitialized && analyserNodeRef.current && (
                <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }}>
                    <h4>Live Audio Output</h4>
                    <AudioVisualizerNinja
                        key={`${canvasWidth}-${canvasHeight}-${analyserNodeRef.current ? 'valid' : 'invalid'}`}
                        analyserNode={analyserNodeRef.current}
                        width={canvasWidth}
                        height={canvasHeight}
                        barCount={64} // Example
                        ninjaSpriteSrc='pixilart-sprite.png'
                    />
                </div>
            )}

            <p style={{ marginTop: '15px', fontSize: '0.9em', color: '#888' }}>
                Hint: Click "Start" to initialize audio and begin fetching live data and predictions.
                The "Beats" metronome BPM will be updated based on predictions.
                The slider manually controls PaceFlow's background music BPM if predictions aren't active or if PaceFlow isn't set to follow predictions.
            </p>
        </div>
    );
}
function roundUpToNearestFive(n) {
    return Math.ceil(n / 5) * 5;
  }
export default NinjaDemoPage;
