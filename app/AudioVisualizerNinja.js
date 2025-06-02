import React, { useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

// --- 常量 (Constants) ---
// 物理效果 (Physics)
const GRAVITY = 0.3; // 重力加速度
const JUMP_POWER = -7; // 起跳力量 (负数向上)

// 动画与视觉 (Animation & Visuals)
const BEAT_JUMP_THRESHOLD = 3; // 每 N 个节拍跳一次 (例如: 3)
const NINJA_SPRITE_WIDTH = 32; // 忍者精灵图中单帧宽度 (像素)
const NINJA_SPRITE_HEIGHT = 32; // 忍者精灵图中单帧高度 (像素)
const NINJA_RUN_FRAMES = 4; // 跑步动画的总帧数
const NINJA_JUMP_FRAME_ROW = 0; // 跳跃帧在精灵图的哪一行 (从0开始)
const NINJA_RUN_FRAME_ROW = 0;  // 跑步帧在精灵图的哪一行 (从0开始)
const BASE_ANIMATION_INTERVAL = 480; // 中等BPM (例如120) 下每帧动画的间隔 (毫秒)
const WAVEFORM_HEIGHT_SCALE = 0.35; // 波形占据画布高度的比例 (0 到 1)
const WAVEFORM_COLOR = 'rgba(180, 255, 180, 0.6)'; // 波形颜色
const BACKGROUND_COLOR = '#1a1c20'; // 背景色
const WIND_LINE_COUNT = 12; // 同时存在的最大风线条数
const BASE_WIND_SPEED_FACTOR = 2.5; // 中等BPM下的基础风速因子
const WIND_LINE_COLOR = 'rgba(210, 210, 255, 0.5)'; // 风线条颜色

// --- 工具函数 (Utility Functions) ---
/**
 * 加载图像的 Promise 封装
 * @param {string} src - 图像 URL
 * @returns {Promise<HTMLImageElement>} - 加载完成的图像元素
 */
const loadImage = (src) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
};

/**
 * 音频可视化忍者组件
 */
function AudioVisualizerNinja({
    width = 600,
    height = 300,
    currentBpm = 120,
    onBeat, // 由外部调用，表示一个节拍发生了
    analyserNode, // Web Audio AnalyserNode (可选, 用于波形)
    ninjaSpriteSrc = 'https://placehold.co/128x64/000000/ffffff?text=NinjaSprite', // 提供你的精灵图路径 (例如: 32x32 * 4帧跑步 + 32x32 * 1帧跳跃 = 128x64)
}) {
    // --- Refs ---
    const canvasRef = useRef(null); // Canvas DOM 元素的引用
    const animationFrameId = useRef(null); // requestAnimationFrame 的 ID
    const ninjaImageRef = useRef(null); // 加载后的忍者图像元素
    const isMountedRef = useRef(false); // 组件是否挂载的标志

    // --- 动画状态 (使用 Ref 避免循环中不必要的重渲染) ---
    const ninjaState = useRef({
        x: 0,           // X 坐标 (会保持在中心)
        y: 0,           // Y 坐标 (当前垂直位置)
        groundY: 0,     // 地面 Y 坐标
        velocityY: 0,   // 垂直速度
        isJumping: false,// 是否正在跳跃
        runFrame: 0,    // 当前跑步动画帧索引
        animationTimer: 0, // 动画帧计时器
        scale: 1,       // 忍者绘制的缩放比例
        windLines: [],  // 风线条数组: { x, y, length, speed }
    });
    const beatCounter = useRef(0); // 节拍计数器 (用于跳跃)
    const waveformData = useRef(null); // 存储波形数据的 Uint8Array

    // --- 初始化 & 清理 Effect ---
    useEffect(() => {
        isMountedRef.current = true;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false; // 关键：保持像素风格

        let localAnimationFrameId = null; // 局部变量存储ID

        // 加载忍者精灵图
        loadImage(ninjaSpriteSrc)
            .then(img => {
                if (!isMountedRef.current) return;
                ninjaImageRef.current = img;
                console.log("忍者精灵图已加载。");
                calculateLayout(canvas.width, canvas.height); // 图像加载后计算布局
                startAnimationLoop(ctx); // 开始动画循环
            })
            .catch(err => console.error("加载忍者精灵图失败:", err));

        // 如果有 AnalyserNode，初始化数据缓冲区
        if (analyserNode) {
            // 需要使用 getByteTimeDomainData，它需要 fftSize 大小的缓冲区
            waveformData.current = new Uint8Array(analyserNode.fftSize);
        }

        // --- 布局计算 ---
        const calculateLayout = (w, h) => {
            // 计算合适的缩放比例，让忍者看起来大小适中 (例如，高度占画布1/5)
            const desiredNinjaHeight = h / 1;
            const scale = Math.max(1, Math.floor(desiredNinjaHeight / NINJA_SPRITE_HEIGHT));
            const scaledHeight = NINJA_SPRITE_HEIGHT * scale;
            const scaledWidth = NINJA_SPRITE_WIDTH * scale;

            ninjaState.current.scale = scale;
            ninjaState.current.groundY = h - scaledHeight - Math.max(5, h * 0.05); // 底部留一些边距
            ninjaState.current.y = ninjaState.current.groundY; // 初始在地面上
            ninjaState.current.x = w / 2 - scaledWidth / 2; // 水平居中

            // 初始化风线条位置 (基于新的布局)
            ninjaState.current.windLines = [];
            for (let i = 0; i < WIND_LINE_COUNT / 2; i++) { // 初始时少生成一些
                addWindLine(w, h);
            }
        };

        // --- 动画循环 ---
        const startAnimationLoop = (context) => {
            let lastTimestamp = 0;
            const draw = (timestamp) => {
                if (!isMountedRef.current || !context) return;

                const deltaTime = timestamp - lastTimestamp;
                lastTimestamp = timestamp;
                // --- 清理画布 ---
                context.fillStyle = BACKGROUND_COLOR;
                context.fillRect(0, 0, canvas.width, canvas.height);

                // --- 绘制背景 (波形) ---
                drawWaveform(context, canvas.width, canvas.height);

                // --- 更新和绘制忍者 ---
                updateNinja(deltaTime, currentBpm); // 传递BPM用于速度调整
                drawNinja(context);

                // --- 更新和绘制效果 (风) ---
                updateAndDrawWindLines(context, canvas.width, canvas.height, deltaTime, currentBpm);

                // --- 请求下一帧 ---
                localAnimationFrameId = requestAnimationFrame(draw);
                animationFrameId.current = localAnimationFrameId; // 更新 Ref 中的 ID
            };
            localAnimationFrameId = requestAnimationFrame(draw);
            animationFrameId.current = localAnimationFrameId;
        };

        // --- 初始布局计算 ---
        calculateLayout(width, height);

        // --- 清理函数 ---
        return () => {
            isMountedRef.current = false;
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
            console.log("可视化组件已卸载。");
        };
    }, [width, height, analyserNode, ninjaSpriteSrc]); // 依赖项：这些改变时重新初始化

    // --- 节拍处理 Effect ---
    // 这个 Effect 依赖于外部调用 onBeat prop
    useEffect(() => {
        const handleBeat = () => {
            if (!isMountedRef.current) return; // 确保组件仍然挂载

            beatCounter.current += 1;
            if (beatCounter.current >= BEAT_JUMP_THRESHOLD && !ninjaState.current.isJumping) {
                ninjaState.current.isJumping = true;
                // 基于画布高度稍微调整跳跃力度
                const jumpScaleFactor = Math.max(0.5, height / 300);
                ninjaState.current.velocityY = JUMP_POWER * jumpScaleFactor;
                beatCounter.current = 0; // 重置计数器
            }
        };

        // 如果 onBeat prop 被提供了，我们假设它会被外部正确调用
        // 注意：这里没有直接的监听器，而是依赖父组件调用此 prop
        if (onBeat) {
            // 将 handleBeat 暴露给父组件的方式取决于父组件如何管理回调
            // 简单的方式是 onBeat prop 本身就是 handleBeat
            // 但为了安全，我们在这里不直接修改 onBeat
            // 父组件需要这样调用： <AudioVisualizerNinja onBeat={handleBeatFromParent} ... />
            // 在父组件中: const handleBeatFromParent = () => { visualizerRef.current?.triggerBeat(); }
            // 或者更直接：父组件管理 Beats 实例，当 Beats 触发节拍时，调用传递给这里的 onBeat prop
        }

        // 这个 effect 的目的是当 onBeat prop 变化时，确保逻辑是最新的
        // 但核心依赖于外部调用 onBeat
        // 为了让外部能触发内部逻辑，可以暴露一个方法给父组件，但这超出了基本要求
        // 最简单的实现是假设 onBeat 会被直接调用

    }, [onBeat, height]); // 依赖 onBeat 和 height (影响跳跃力度)

    // --- 绘图函数 (Drawing Functions) ---

    // 绘制波形
    const drawWaveform = useCallback((ctx, w, h) => {
        if (!analyserNode || !waveformData.current) return;

        analyserNode.getByteTimeDomainData(waveformData.current); // 获取时域数据

        ctx.lineWidth = 2;
        ctx.strokeStyle = WAVEFORM_COLOR;
        ctx.beginPath();

        const bufferLength = analyserNode.fftSize; // 使用 fftSize
        const sliceWidth = (w * 1.0) / bufferLength;
        let x = 0;
        const waveBaseY = h * (1 - WAVEFORM_HEIGHT_SCALE * 0.5); // 波形基线偏下

        for (let i = 0; i < bufferLength; i++) {
            // 将数据从 0-255 映射到 -1 到 1，然后缩放到画布高度
            const v = (waveformData.current[i] - 128) / 128.0; // 归一化到 -1 到 1
            const y = waveBaseY + (v * h * WAVEFORM_HEIGHT_SCALE * 0.5); // 计算 Y 坐标

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        // ctx.lineTo(w, waveBaseY); // 可以让线结束在基线上
        ctx.stroke();
    }, [analyserNode]); // 依赖 analyserNode

    // 更新忍者状态
    const updateNinja = useCallback((deltaTime, bpm) => {
        const state = ninjaState.current;
        // BPM 影响因子 (防止 BPM 过低导致速度为0或负数)
        const bpmFactor = Math.max(0.3, bpm / 120); // 120 BPM 时为 1
        // 动画帧间隔时间，BPM 越高，间隔越短 (动画越快)
        const frameInterval = BASE_ANIMATION_INTERVAL / bpmFactor;

        // --- 物理更新 (跳跃) ---
        if (state.isJumping) {
            // 应用速度和重力 (考虑 deltaTime 使其帧率无关)
            state.y += state.velocityY * (deltaTime / 16.67); // 假设 60fps 为基准 (1000/60 ≈ 16.67)
            state.velocityY += GRAVITY * (deltaTime / 16.67);

            // 检测是否落地
            if (state.y >= state.groundY) {
                state.y = state.groundY;
                state.isJumping = false;
                state.velocityY = 0;
            }
        }

        // --- 动画帧更新 (跑步) ---
        if (!state.isJumping && deltaTime > 0) {
            state.animationTimer += deltaTime;
            if (state.animationTimer >= frameInterval) {
                state.runFrame = (state.runFrame + 1) % NINJA_RUN_FRAMES;
                state.animationTimer = 0; // 重置计时器
            }
        }
    }, []); // 无显式依赖，因为它操作 Ref

    // 绘制忍者
    const drawNinja = useCallback((ctx) => {
        if (!ninjaImageRef.current) return; // 图像未加载则不绘制

        const state = ninjaState.current;
        const img = ninjaImageRef.current;
        const scale = state.scale;
        const scaledWidth = NINJA_SPRITE_WIDTH * scale;
        const scaledHeight = NINJA_SPRITE_HEIGHT * scale;

        // --- 选择精灵图帧 ---
        let sourceX = 0;
        let sourceY = 0;

        if (state.isJumping) {
            // 假设跳跃帧是第 NINJA_RUN_FRAMES 个（索引从0开始），在指定行
            sourceX = 0 * NINJA_SPRITE_WIDTH; // 或者特定的跳跃帧X坐标
            sourceY = NINJA_JUMP_FRAME_ROW * NINJA_SPRITE_HEIGHT;
        } else {
            // 跑步帧
            sourceX = state.runFrame * NINJA_SPRITE_WIDTH;
            sourceY = NINJA_RUN_FRAME_ROW * NINJA_SPRITE_HEIGHT;
        }

        // --- 绘制 ---
        // 使用 Math.floor 确保像素对齐
        ctx.drawImage(
            img,
            sourceX, sourceY,           // 精灵图上的源坐标
            NINJA_SPRITE_WIDTH, NINJA_SPRITE_HEIGHT, // 源尺寸
            Math.floor(state.x), Math.floor(state.y), // 画布上的目标坐标
            scaledWidth, scaledHeight    // 目标尺寸 (已缩放)
        );
    }, []); // 无显式依赖

    // 添加风线条
    const addWindLine = useCallback((w, h, bpm) => {
        const state = ninjaState.current;
        const scale = state.scale;
        const bpmFactor = Math.max(0.3, bpm / 120);
        const speed = (BASE_WIND_SPEED_FACTOR + Math.random() * 1.5) * bpmFactor * scale; // 风速受BPM和缩放影响
        const length = (15 + Math.random() * 25) * bpmFactor * scale; // 长度也受影响
        // 起始位置在忍者中心偏左，稍微随机
        const startX = state.x + (NINJA_SPRITE_WIDTH * scale / 2) - length - (Math.random() * 30 * scale);
        // Y 坐标在忍者身体中部范围内随机
        const y = state.y + (NINJA_SPRITE_HEIGHT * scale * (0.3 + Math.random() * 0.4));

        state.windLines.push({
            x: startX,
            y: Math.floor(y),
            length: Math.floor(length),
            speed: speed
        });

        // 如果风线条过多，移除最旧的
        if (state.windLines.length > WIND_LINE_COUNT * 1.2) { // 允许稍微超出
            state.windLines.splice(0, state.windLines.length - WIND_LINE_COUNT);
        }
    }, []);

    // 更新和绘制风线条
    const updateAndDrawWindLines = useCallback((ctx, w, h, deltaTime, bpm) => {
        const state = ninjaState.current;
        const scale = state.scale;
        const bpmFactor = Math.max(0.3, bpm / 120);

        // 根据 BPM 决定是否添加新线条 (BPM 越高越频繁)
        if (Math.random() < 0.15 * bpmFactor) {
            addWindLine(w, h, bpm);
        }

        ctx.strokeStyle = WIND_LINE_COLOR;
        ctx.lineWidth = Math.max(1, Math.floor(scale * bpmFactor)); // 线条粗细也受影响

        for (let i = state.windLines.length - 1; i >= 0; i--) {
            const line = state.windLines[i];

            // 更新位置 (考虑 deltaTime)
            line.x += line.speed * (deltaTime / 16.67); // 基于 60fps 标准化速度

            // 绘制线条
            ctx.beginPath();
            ctx.moveTo(Math.floor(line.x), line.y);
            ctx.lineTo(Math.floor(line.x + line.length), line.y);
            ctx.stroke();

            // 如果线条完全移出忍者右侧一段距离，则移除
            if (line.x > state.x + (NINJA_SPRITE_WIDTH * scale) + 50 * scale) {
                state.windLines.splice(i, 1);
            }
        }
    }, [addWindLine]); // 依赖 addWindLine

    // --- 渲染 Canvas ---
    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{ display: 'block', background: BACKGROUND_COLOR }} // 样式设置背景色
        />
    );
}

// --- PropTypes ---
AudioVisualizerNinja.propTypes = {
    width: PropTypes.number, // 画布宽度
    height: PropTypes.number, // 画布高度
    currentBpm: PropTypes.number, // 当前 BPM
    onBeat: PropTypes.func, // 节拍回调函数 (由父组件调用)
    analyserNode: PropTypes.instanceOf(AnalyserNode), // Web Audio AnalyserNode (可选)
    ninjaSpriteSrc: PropTypes.string, // 忍者精灵图 URL
};

export default AudioVisualizerNinja;

