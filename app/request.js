// --- API Configuration ---
const BASE_URL = "http://localhost:8080"; // Ensure this matches your predict.py port
const DEMO_DATA_ENDPOINT = `${BASE_URL}/demo_data`;
const DEMO_PREDICT_ENDPOINT = `${BASE_URL}/demo_predict`;

/**
 * Fetches a single data point from the demo_data endpoint.
 * @param {number} t - The time parameter for the API.
 * @returns {Promise<{ data: { heart_rate: number, speed: number } | null, error: string | null }>}
 */
export const fetchDemoDataPointFromAPI = async (t) => {
    try {
        const response = await fetch(`${DEMO_DATA_ENDPOINT}?t=${parseInt(t)}`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000) // 2-second timeout
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
            console.error(`API Error (/demo_data t=${t}): ${errorData.error || response.statusText}`);
            return { data: null, error: `Demo data fetch failed: ${errorData.error || response.statusText}` };
        }
        
        const data = await response.json();
        if (data.error) {
            console.error(`API Error (/demo_data t=${t}): ${data.error}`);
            return { data: null, error: `API Error (demo_data): ${data.error}` };
        }
        const { heart_rate: hr, speed: sp,origin_timestamp: ts } = data;
        if (hr !== undefined && sp !== undefined) {
            return { 
                data: { 
                    heart_rate: parseFloat(hr), 
                    speed: parseFloat(sp),
                    ts: parseInt(ts)
                }, 
                error: null 
            };
        } else {
            console.warn(`Warning: Missing keys in demo_data response (t=${t}):`, data);
            return { data: null, error: "Demo data response missing keys." };
        }
    } catch (error) {
        if (error.name === 'TimeoutError') {
            console.error(`Timeout fetching demo data (t=${t})`);
            return { data: null, error: "Demo data request timed out." };
        }
        console.error(`Request Error (/demo_data t=${t}):`, error);
        return { data: null, error: `Network error fetching demo data: ${error.message}` };
    }
};

/**
 * Fetches prediction data from the demo_predict endpoint.
 * @param {number} idx - The prediction index parameter.
 * @returns {Promise<{ data: { predicted_speed: number, next_idx: number, current_input_end_origin_timestamp: number, next_idx_origin_timestamp: number } | null, error: string | null }>}
 */
export const fetchPredictionDataFromAPI = async (idx) => {
    try {
        const response = await fetch(`${DEMO_PREDICT_ENDPOINT}?idx=${idx}`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000) // 3-second timeout
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
            console.error(`API Error (/demo_predict idx ${idx}): ${errorData.error || response.statusText}`);
            return { data: null, error: `Prediction fetch failed: ${errorData.error || response.statusText}` };
        }
        
        const data = await response.json();

        if (data.error) {
            console.error(`API Error (/demo_predict idx ${idx}): ${data.error}`);
            return { data: null, error: `API Error (demo_predict): ${data.error}` };
        }
        
        const {
            predicted_speed,
            next_idx,
            current_input_end_origin_timestamp: input_end_ts,
            next_idx_origin_timestamp: next_idx_ts
        } = data;

        if ([predicted_speed, next_idx, input_end_ts, next_idx_ts].every(v => v !== undefined && v !== null)) {
            return {
                data: {
                    predicted_speed: parseFloat(predicted_speed),
                    next_idx: parseInt(next_idx, 10),
                    current_input_end_origin_timestamp: parseFloat(input_end_ts),
                    next_idx_origin_timestamp: parseFloat(next_idx_ts),
                },
                error: null
            };
        } else {
            const warningMsg = `Missing keys in demo_predict response for idx=${idx}: ${JSON.stringify(data)}`;
            console.warn(warningMsg);
            return { data: null, error: "Prediction data response missing keys." };
        }
    } catch (error) {
        const errorMsg = error.name === 'TimeoutError' ? `Timeout fetching prediction for idx=${idx}` : `Request Error (/demo_predict idx ${idx}): ${error.message}`;
        console.error(errorMsg);
        return { data: null, error: errorMsg };
    }
};
