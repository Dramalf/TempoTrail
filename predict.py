import json
import numpy as np
import pandas as pd
from flask_cors import CORS # 导入 CORS
from flask import Flask, request, jsonify
from pathlib import Path
from fitparse import FitFile
import os
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg') # Use Agg backend for non-interactive plotting

# Attempt to import the model class
try:
    from model import FitRecSpeedPredictor
except ImportError:
    # This fallback is for environments where 'model.py' might not be directly in PYTHONPATH
    # You might need to adjust your PYTHONPATH or project structure for robust imports
    import sys
    # Assuming model.py is in the same directory or a known relative path
    current_dir = Path(__file__).resolve().parent
    sys.path.append(str(current_dir))
    try:
        from model import FitRecSpeedPredictor
    except ImportError as e:
        raise ImportError(f"Could not import FitRecSpeedPredictor from model.py: {e}. Ensure model.py is accessible.")


app = Flask(__name__)
CORS(app) # 在这里启用 CORS，允许所有源的请求

# --- Global Variables ---
predictor = None
demo_item_df = None
DEMO_ID = 35
MODEL_CONFIG_PATH = "model.json" # Path to the model configuration
def extract_fit_data():
    # 用于存储提取数据的列表
    timestamps = []
    heart_rates = []
    speeds = []

    file_path = '5k.fit' # 确保这个文件与你的脚本在同一目录下，或者提供完整路径

    print(f"Attempting to process '{file_path}'...")

    try:
        # 加载 FIT 文件，并根据你的要求设置 check_crc=False
        # 这会尝试忽略 CRC 校验错误，但如果文件有更严重的结构问题，仍然可能失败
        fitfile = FitFile(file_path, check_crc=False)

        # 遍历文件中的 'record' 消息 (这些通常包含逐秒的数据)
        for record in fitfile.get_messages('record'):
            # 从每个记录中提取所需字段的值
            # record.get_value('field_name') 会在字段不存在时返回 None，这比直接访问更安全

            timestamp_val = record.get_value('timestamp')
            heart_rate_val = record.get_value('heart_rate')
            speed_val = record.get_value('speed') # 速度通常以 m/s 为单位

            # 将提取的值（即使是 None）附加到各自的列表中
            timestamps.append(timestamp_val)
            heart_rates.append(heart_rate_val)
            speeds.append(speed_val)

        # 检查是否收集到了数据
        if not timestamps:
            print("No 'record' messages found or no data extracted.")
        else:
            # 使用收集到的数据创建 pandas DataFrame
            df = pd.DataFrame({
                'timestamp': timestamps,
                'heart_rate': heart_rates,
                'speed': speeds
            })
            df=df.dropna()

            # （可选）将 timestamp 列转换为更易读的格式或设置为索引
            # fitparse 通常已经将 timestamp 解析为 datetime 对象
            # df['timestamp'] = pd.to_datetime(df['timestamp']) # 如果需要确保
            # df.set_index('timestamp', inplace=True) # 如果想把时间戳设为索引
            df['timestamp_dt'] = pd.to_datetime(df['timestamp']) # 保留原始datetime对象，方便查看
            df['speed'] = df['speed']*3.6

            # 然后转换为 Unix 时间戳 (毫秒)，并确保为64位整数类型以容纳大数值
            df['timestamp'] = df['timestamp_dt'].astype('int64') // 10**9
            df['origin_timestamp'] = df['timestamp'] - df['timestamp'].iloc[0]

            # 打印 DataFrame 的信息和前几行以供查阅
            print("\nDataFrame Info:")
            df.info()
            print("\nDataFrame Head:")
            print(df.head())
            return df
            # 如果需要，你可以将 DataFrame 保存到 CSV 文件
            # df.to_csv('extracted_data.csv', index=False)
            # print("\nData saved to extracted_data.csv")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        
def load_demo_data(data_path_str="data/raw_run_data.npy", session_id_to_load=0):
    """
    Loads a specific session from the .npy file to be used as demo data.
    It expects the session data to be a dictionary containing at least
    'tar_heart_rate', 'tar_derived_speed', and 'timestamp'.
    """
    data_path = Path(data_path_str)
    if not data_path.exists():
        raise FileNotFoundError(f"Demo data file not found: {data_path}")

    raw_data = np.load(data_path, allow_pickle=True)
    session_dict = None

    # Determine the actual data structure to process
    if isinstance(raw_data, np.ndarray) and raw_data.ndim == 0:
        # Case: .npy file is a 0-dim array containing a single Python object (list or dict)
        actual_data_to_process = raw_data.item()
        print(f"Unpacked 0-dim NumPy array. Data type after unpacking: {type(actual_data_to_process)}")
    else:
        # Case: .npy file is a list, a dict, or a multi-dimensional array (e.g., array of dicts)
        actual_data_to_process = raw_data
        print(f"Loaded data directly. Data type: {type(actual_data_to_process)}")

    # Extract the specific session dictionary
    if isinstance(actual_data_to_process, list):
        if 0 <= session_id_to_load < len(actual_data_to_process):
            session_data_item = actual_data_to_process[session_id_to_load]
            if isinstance(session_data_item, dict):
                session_dict = session_data_item
                print(f"Loaded session {session_id_to_load} from list for demo.")
            else:
                raise TypeError(f"Item at index {session_id_to_load} in list is not a dict, but {type(session_data_item)}")
        else:
            raise ValueError(f"DEMO_ID {session_id_to_load} is out of bounds for the data list (length {len(actual_data_to_process)}).")
    elif isinstance(actual_data_to_process, dict):
        # This case implies the entire .npy file is a single session dictionary.
        # session_id_to_load might be ignored here unless further logic is added.
        session_dict = actual_data_to_process
        print("Loaded single session dict for demo.")
    elif isinstance(actual_data_to_process, np.ndarray):
        # Handles cases where actual_data_to_process is an array of objects (e.g., dicts)
        print(f"Data is a NumPy array with shape {actual_data_to_process.shape} and dtype {actual_data_to_process.dtype}.")
        if actual_data_to_process.ndim >= 1: # Check if it's at least 1D
            if 0 <= session_id_to_load < len(actual_data_to_process):
                potential_session = actual_data_to_process[session_id_to_load]
                if isinstance(potential_session, dict):
                    session_dict = potential_session
                    print(f"Loaded session {session_id_to_load} from NumPy array of objects for demo.")
                else:
                    raise ValueError(f"Element at DEMO_ID {session_id_to_load} in NumPy array is not a dict, but {type(potential_session)}.")
            else:
                raise ValueError(f"DEMO_ID {session_id_to_load} is out of bounds for the NumPy data array (length {len(actual_data_to_process)}).")
        else:
            raise TypeError(f"Unsupported NumPy array structure in {data_path_str}: shape {actual_data_to_process.shape}. Expected at least 1D array.")
    else:
        raise TypeError(f"Unsupported data type in {data_path_str} after initial processing: {type(actual_data_to_process)}")

    if not session_dict:
        raise ValueError(f"Could not extract a valid session dictionary for DEMO_ID {session_id_to_load} from the data file.")

    # Ensure the required keys are present in the extracted session_dict
    required_keys = ['heart_rate', 'speed', 'timestamp']
    if not all(k in session_dict for k in required_keys):
        missing = [k for k in required_keys if k not in session_dict]
        available = list(session_dict.keys())
        raise ValueError(f"Demo session data (ID: {session_id_to_load}) is missing required keys: {missing}. Available keys: {available}")

    # Extract data using the confirmed keys
    heart_rate = np.array(session_dict['heart_rate'])
    speed = np.array(session_dict['speed'])
    timestamp = np.array(session_dict['timestamp'])

    df = pd.DataFrame({
        'timestamp': timestamp,
        'heart_rate': heart_rate, # This column will be used by the model and plotting
        'speed': speed            # This column will be used by the model and plotting
    })

    df = df.sort_values('timestamp').reset_index(drop=True)
    if df.empty:
        raise ValueError("Demo data DataFrame is empty after initial processing.")

    df['origin_timestamp'] = df['timestamp'] - df['timestamp'].iloc[0]
    
    # Basic cleaning: remove NaNs and obvious invalids, but not the extensive cleaning from model.py
    df = df.dropna(subset=['heart_rate', 'speed', 'timestamp'])
    df = df[(df['speed'] >= 0) & (df['heart_rate'] > 0)]
    df = df.reset_index(drop=True)

    if df.empty:
        raise ValueError("Demo data DataFrame is empty after basic cleaning.")
    print(f"Demo data for session ID {session_id_to_load} loaded and processed. Shape: {df.shape}")
    return df

def initialize_app():
    global predictor, demo_item_df
    print("Initializing Flask app...")
    try:
        predictor = FitRecSpeedPredictor() # Initialize with default or loaded params
        predictor.load_model_config(MODEL_CONFIG_PATH)
        print(f"Model loaded successfully from {MODEL_CONFIG_PATH}.")

        demo_item_df = load_demo_data(session_id_to_load=DEMO_ID)
        print(f"Demo data for session ID {DEMO_ID} loaded successfully.")

        if demo_item_df is not None and not demo_item_df.empty:
            try:
                fig, ax1 = plt.subplots(figsize=(12, 6))
                color = 'tab:red'
                ax1.set_xlabel('Origin Timestamp (seconds)')
                ax1.set_ylabel('Speed (m/s or km/h)', color=color) # Clarify unit if known
                ax1.plot(demo_item_df['origin_timestamp'], demo_item_df['speed'], color=color, label='Speed')
                ax1.tick_params(axis='y', labelcolor=color)
                ax1.grid(True, axis='y', linestyle='--', alpha=0.7)

                ax2 = ax1.twinx()
                color = 'tab:blue'
                ax2.set_ylabel('Heart Rate (bpm)', color=color) # Clarify unit
                ax2.plot(demo_item_df['origin_timestamp'], demo_item_df['heart_rate'], color=color, label='Heart Rate')
                ax2.tick_params(axis='y', labelcolor=color)

                fig.suptitle(f'Demo Data (ID: {DEMO_ID}) - Speed and Heart Rate vs. Time', fontsize=16)
                fig.tight_layout(rect=[0, 0, 1, 0.96])
                
                lines, labels = ax1.get_legend_handles_labels()
                lines2, labels2 = ax2.get_legend_handles_labels()
                ax2.legend(lines + lines2, labels + labels2, loc='upper right')

                plot_filename = f"demo_{DEMO_ID}.png"
                # plt.savefig(plot_filename)
                # plt.close(fig)
                print(f"Demo data plot saved to {plot_filename}")
            except Exception as plot_e:
                print(f"Error generating or saving demo data plot: {plot_e}")

    except FileNotFoundError as e:
        print(f"Initialization Error: Required file not found. {e}")
        print("Please ensure 'model.json', its associated weights file, and demo data exist.")
        # Optionally, exit or run in a degraded mode if critical components are missing
        # For now, we'll let Flask start but endpoints might fail.
        predictor = None # Ensure predictor is None if loading failed
        demo_item_df = None
    except Exception as e:
        print(f"An error occurred during initialization: {e}")
        predictor = None
        demo_item_df = None


@app.route('/demo_predict', methods=['GET'])
def demo_predict_api():
    global predictor, demo_item_df
    if predictor is None or predictor.model is None or demo_item_df is None or demo_item_df.empty:
        return jsonify({"error": "Service not initialized or demo data/model not loaded"}), 500

    try:
        idx_str = request.args.get('idx')
        if idx_str is None:
            return jsonify({"error": "Missing 'idx' parameter"}), 400

        idx = int(idx_str)
        if not (0 <= idx < len(demo_item_df)):
            return jsonify({"error": f"idx {idx} is out of bounds for demo_item_df (length {len(demo_item_df)})"}), 400

        if predictor.sampling_rate <= 0:
             return jsonify({"error": "Invalid model sampling rate configuration."}), 500
        model_window_samples = int(predictor.window_duration / predictor.sampling_rate)

        if model_window_samples <= 0:
             return jsonify({"error": "Invalid model window configuration (window_samples <= 0)"}), 500

        start_index_for_model_input = max(0, idx - model_window_samples + 1)
        input_sequence_df = demo_item_df.iloc[start_index_for_model_input : idx + 1]

        if len(input_sequence_df) < model_window_samples:
            return jsonify({
                "error": f"Not enough data points ({len(input_sequence_df)}) to form model input window of {model_window_samples} samples ending at index {idx}."
            }), 400
        
        input_array = input_sequence_df[['speed', 'heart_rate']].values
        
        if input_array.shape[0] != model_window_samples or input_array.shape[1] != 2:
             return jsonify({
                "error": f"Prepared input array shape {input_array.shape} does not match model expectation ({model_window_samples}, 2)."
            }), 500

        # Timestamp of the last data point in the input window (i.e., at idx)
        current_input_end_origin_timestamp = demo_item_df['origin_timestamp'].iloc[idx]
        predicted_speed = predictor.predict(input_array)

        samples_to_advance = int(predictor.prediction_duration / predictor.sampling_rate)
        print(f"samples_to_advance={samples_to_advance}")
        if samples_to_advance <=0: samples_to_advance = 1 

        next_idx_val = min(idx + samples_to_advance, len(demo_item_df) - 1)
        
        next_idx_origin_timestamp = -1.0 # Default if somehow next_idx_val is out of bounds after calculation
        if 0 <= next_idx_val < len(demo_item_df):
            next_idx_origin_timestamp = demo_item_df['origin_timestamp'].iloc[next_idx_val]
        else: # Should not happen if logic is correct, but as a safeguard
            print(f"Warning: next_idx_val {next_idx_val} is out of bounds for demo_item_df (len {len(demo_item_df)}) after advancing.")


        return jsonify({
            "predicted_speed": float(predicted_speed),
            "next_idx": int(next_idx_val),
            "current_input_end_origin_timestamp": float(current_input_end_origin_timestamp),
            "next_idx_origin_timestamp": float(next_idx_origin_timestamp)
        })

    except ValueError as e:
        return jsonify({"error": f"Invalid parameter value: {e}"}), 400
    except Exception as e:
        app.logger.error(f"Error in /demo_predict: {e}", exc_info=True)
        return jsonify({"error": f"An internal error occurred: {e}"}), 500


@app.route('/demo_data', methods=['GET'])
def demo_data_api():
    global demo_item_df
    if demo_item_df is None or demo_item_df.empty:
        return jsonify({"error": "Demo data not loaded"}), 500

    try:
        t_str = request.args.get('t')
        if t_str is None:
            return jsonify({"error": "Missing 't' (origin_timestamp) parameter"}), 400
        
        t = float(t_str)

        # Find the row where origin_timestamp is closest to t
        closest_idx = (demo_item_df['origin_timestamp'] - t).abs().idxmin()
        result_row = demo_item_df.loc[closest_idx].to_dict()

        # Convert numpy types to native Python types for JSON serialization
        for key, value in result_row.items():
            if isinstance(value, np.integer):
                result_row[key] = int(value)
            elif isinstance(value, np.floating):
                result_row[key] = float(value)
            elif isinstance(value, np.bool_):
                 result_row[key] = bool(value)


        return jsonify(result_row)

    except ValueError:
        return jsonify({"error": "Invalid 't' parameter, must be a number"}), 400
    except Exception as e:
        app.logger.error(f"Error in /demo_data: {e}", exc_info=True)
        return jsonify({"error": f"An internal error occurred: {e}"}), 500

if __name__ == '__main__':
    initialize_app()
    if predictor is None or demo_item_df is None:
        print("Failed to initialize critical components. The app might not work correctly.")
        print("Please ensure model.json, model_weights.h5 and data/run_sample_10000.npy are present and correct.")
    app.run(debug=True, host='0.0.0.0', port=8080)
