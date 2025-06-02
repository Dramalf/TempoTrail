import aubio
import numpy as np # Aubio 通常与 numpy 结合使用

# WAV文件的路径
audio_file = '100.wav'

samplerate = 0 # 设置为0让aubio从文件中读取
win_s = 512    # FFT 窗口大小
hop_s = win_s // 2 # 帧之间的跳数

try:
    # 创建音频源对象
    s = aubio.source(audio_file, samplerate, hop_s)
    samplerate = s.samplerate # 获取实际采样率

    # 创建 tempo (BPM) 检测对象
    o = aubio.tempo("default", win_s, hop_s, samplerate)

    # 存储检测到的节拍时间点
    beats = []
    # 总帧数
    total_frames = 0

    while True:
        samples, read = s() # 读取一帧
        is_beat = o(samples) # 检测节拍
        if is_beat:
            # 记录节拍发生的时间（以秒为单位）
            beats.append(o.get_last_s())
            # 你也可以直接获取当前的BPM估计：
            # current_bpm = o.get_bpm()
            # print(f"Current estimated BPM: {current_bpm}")
        total_frames += read
        if read < hop_s: # 到达文件末尾
            break

    # 计算整体 BPM 的一种方法（基于检测到的节拍间隔）
    if len(beats) > 1:
        # 计算相邻节拍之间的时间间隔的中位数
        bpms = 60. / np.diff(beats)
        estimated_bpm = np.median(bpms)
        print(bpms)
        print(f"文件的估计 BPM (基于节拍间隔中位数): {estimated_bpm:.2f}")
    else:
        # 如果节拍数太少，尝试获取最后一次的BPM估计值
        # 注意：这可能不如基于间隔的方法稳定
        final_bpm_estimate = o.get_bpm()
        if final_bpm_estimate > 0:
             print(f"文件的估计 BPM (基于aubio最终估计): {final_bpm_estimate:.2f}")
        else:
             print("未能检测到足够的节拍来估计BPM。")


except Exception as e:
    print(f"处理文件时出错: {e}")