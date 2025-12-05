/**
 * Sleep Age Simulator - Single File Bundle
 * Merged models.js and app.js to prevent file:// origin issues.
 */

// --- MODELS ---

const STAGES = {
    WAKE: 0,
    REM: 1,
    N1: 2,
    N2: 3,
    N3: 4
};

class ScientificConstants {
    // Data interpolated from Ohayon et al. (2004) & National Sleep Foundation
    static getAgeProfile(age) {
        // 1. Total Sleep Time (Minutes) - PURE SLEEP TARGET
        // We will add WASO on top of this for Total Time in Bed.
        let tst = 0;
        if (age <= 5) tst = 660; // 11h
        else if (age <= 12) tst = 600; // 10h
        else if (age <= 18) tst = 510; // 8.5h
        else if (age <= 80) tst = 480 - ((age - 18) * 2.0); // 20yo=476m, 80yo=352m (approx 6h)
        else tst = 360; // 6h floor

        // 2. Sleep Architecture Percentages (Target)
        // N3: Deep Sleep. User Request: 41yo should be ~20-25%.
        // We will maintain a high baseline through adulthood.
        let n3P = 0;
        if (age <= 10) n3P = 0.25;
        else if (age <= 20) n3P = 0.25;
        else if (age <= 60) n3P = 0.25 - ((age - 20) * 0.00125); // Very slow drop (0.25 -> 0.20 at 60)
        else n3P = 0.15; // Floor at 15% for elderly

        // REM: Relatively stable, slight decline
        let remP = 0.25;
        if (age > 60) remP = 0.20;

        // WASO (Wake After Sleep Onset): Increases linearly
        // Minutes of wakefulness
        let wasoMins = 10;
        if (age > 20) wasoMins += (age - 20) * 1.8;

        // N1: Increases with age (Ohayon 2004)
        let n1P = 0.05;
        if (age > 20) n1P += (age - 20) * 0.0015;

        // N2: The filler
        let n2P = 1.0 - (n3P + remP + n1P);

        return { tst, n3P, remP, n1P, n2P, wasoMins };
    }
}

class HypnogramGenerator {
    generate(config) {
        const { age, gender, alcohol, caffeine, caffeineTime, caffeineMetabolism, sdbSeverity, nocturia, chronotype, socialJetLag, blueLight } = config;

        // 1. Get Base Profile
        const profile = ScientificConstants.getAgeProfile(age);
        let { tst, n3P, remP, n1P, n2P, wasoMins } = profile;

        // --- ADVANCED MODIFIERS ---

        // 0. Blue Light (Screens)
        // Stronger effect as requested
        let blueLightLatency = 0;
        if (blueLight) {
            blueLightLatency = 45; // +45 mins latency (Significant)
            tst -= 30; // Lose 30 mins of sleep
            n3P *= 0.85; // Deep sleep quality hit
            remP *= 0.9; // REM suppression
            n1P += 0.03; // More light sleep
        }

        // 1. Caffeine Model (Nuanced)
        let halfLife = 6;
        if (caffeineMetabolism === 'fast') halfLife = 4;
        if (caffeineMetabolism === 'slow') halfLife = 8;

        const activeCaffeine = caffeine * Math.pow(0.5, caffeineTime / halfLife);

        if (activeCaffeine > 0.1) {
            n3P *= Math.max(0.5, 1 - (activeCaffeine * 0.15));
            n1P += activeCaffeine * 0.03;
        }

        // 2. Alcohol Model (Biphasic)
        if (alcohol > 0) {
            wasoMins += alcohol * 20;
        }

        // 3. Social Jet Lag
        let bedtimeShift = 0;
        if (socialJetLag) {
            bedtimeShift = 180;
            tst -= 60;
            wasoMins += 30;
            n3P *= 0.9;
        }

        // Gender: Men have less N3, more WASO
        // User Feedback: "41yo male 8% N3 is too low".
        // REMOVED PENALTY entirely to meet user target of 20-25%
        if (gender === 'male' && age > 30) {
            // n3P *= 0.95; // Removed
            wasoMins *= 1.1; // Kept slight fragmentation
        }

        // Menopause (Perimenopause)
        // Research: Hot flashes, increased WASO, increased Latency, reduced Deep Sleep.
        if (config.isMenopausal) {
            wasoMins += 40; // Significant wakefulness (Hot flashes)
            n3P *= 0.85; // Reduced deep sleep
            remP *= 0.9; // Reduced REM
            n1P += 0.05; // More light sleep
            // Latency is handled below in cycle generation
        }

        // SDB
        if (sdbSeverity > 0) {
            const factor = sdbSeverity / 10;
            n3P *= (1 - factor * 0.8);
            remP *= (1 - factor * 0.3);
            wasoMins += factor * 60;
            n1P += factor * 0.2;
        }

        // Nocturia
        if (nocturia > 0) {
            wasoMins += nocturia * 10;
        }

        // Recalculate N2
        // TST is now PURE SLEEP target.
        const totalP = n3P + remP + n1P;
        if (totalP > 0.95) {
            const scale = 0.95 / totalP;
            n3P *= scale; remP *= scale; n1P *= scale;
        }
        n2P = 1.0 - (n3P + remP + n1P);

        // 3. Generate Cycles (Block Engine)
        // We generate blocks for TST (Sleep) and INSERT Wake blocks for WASO.

        const cycleLength = 90;
        const numCycles = Math.floor(tst / cycleLength);
        const blocks = [];
        let currentTime = 0;

        // Latency
        let latency = 15 + (age > 60 ? 10 : 0) + (activeCaffeine * 20) + blueLightLatency;
        if (alcohol > 0) latency = Math.max(5, latency - (alcohol * 5));
        if (config.isMenopausal) latency += 15; // Difficulty falling asleep

        blocks.push({ stage: STAGES.WAKE, duration: latency, start: 0 });
        currentTime += latency;

        // Initial N1
        const initialN1 = 5 + (age > 50 ? 5 : 0) + (activeCaffeine * 5);
        blocks.push({ stage: STAGES.N1, duration: initialN1, start: currentTime });
        currentTime += initialN1;

        // Calculate Wake Injection Points
        // We want to inject `wasoMins` of wakefulness distributed across the night.
        // Strategy: Inject a Wake block after some cycles.
        // Or better: Randomly interrupt sleep blocks? No, that's messy.
        // Let's inject Wake blocks between cycles or within cycles.

        // We'll distribute WASO into `numWakeEvents` chunks.
        const numWakeChunks = Math.max(1, Math.floor(wasoMins / 15)); // Approx 15 min chunks
        const wakeChunkDuration = wasoMins / numWakeChunks;

        // Determine where to insert them (random cycle indices)
        const wakeInsertionIndices = [];
        for (let k = 0; k < numWakeChunks; k++) {
            wakeInsertionIndices.push(Math.floor(Math.random() * numCycles));
        }
        wakeInsertionIndices.sort((a, b) => a - b);

        let wakeChunkIndex = 0;

        for (let i = 0; i < numCycles; i++) {
            const progress = i / numCycles;

            // Local Cycle Percentages
            let localN3 = n3P * (1 - progress) * 2.5;
            let localREM = remP * (0.5 + progress * 1.5);

            // Alcohol Logic
            if (alcohol > 0) {
                if (i < numCycles / 2) {
                    localN3 *= (1 + alcohol * 0.1);
                    localREM *= Math.max(0.1, 1 - (alcohol * 0.3));
                } else {
                    localREM *= (1 + alcohol * 0.2);
                    localN3 *= 0.5;
                }
            }

            // Normalize
            let localN2 = 1.0 - (localN3 + localREM);
            if (localN2 < 0) {
                const overflow = -localN2;
                localN3 -= overflow / 2;
                localREM -= overflow / 2;
                localN2 = 0;
            }

            const cycleMins = cycleLength;

            // N2 Bridge (Pre)
            blocks.push({ stage: STAGES.N2, duration: cycleMins * (localN2 * 0.4), start: currentTime });
            currentTime += cycleMins * (localN2 * 0.4);

            // N3
            if (localN3 > 0.05) {
                blocks.push({ stage: STAGES.N3, duration: cycleMins * localN3, start: currentTime });
                currentTime += cycleMins * localN3;
            } else {
                blocks.push({ stage: STAGES.N2, duration: cycleMins * localN3, start: currentTime });
                currentTime += cycleMins * localN3;
            }

            // N2 Bridge (Post)
            blocks.push({ stage: STAGES.N2, duration: cycleMins * (localN2 * 0.6), start: currentTime });
            currentTime += cycleMins * (localN2 * 0.6);

            // REM
            blocks.push({ stage: STAGES.REM, duration: cycleMins * localREM, start: currentTime });
            currentTime += cycleMins * localREM;

            // Post-REM N1
            if (i < numCycles - 1) {
                const transN1 = 2 + (age > 50 ? 2 : 0);
                blocks.push({ stage: STAGES.N1, duration: transN1, start: currentTime });
                currentTime += transN1;
            }

            // --- INJECT REAL WAKE BLOCKS ---
            // If this cycle index matches an insertion point, add a Wake Block
            while (wakeChunkIndex < wakeInsertionIndices.length && wakeInsertionIndices[wakeChunkIndex] === i) {
                // Add Wake Block
                blocks.push({ stage: STAGES.WAKE, duration: wakeChunkDuration, start: currentTime });
                currentTime += wakeChunkDuration;
                wakeChunkIndex++;
            }
        }

        // 4. Fragmentation Overlay (Thin Lines)
        // These are MICRO-arousals (don't add time, just paint over)
        // We reduced WASO by converting it to blocks, but we can keep some micro-arousals for visual texture.
        const wakeEvents = [];
        const numMicroArousals = 5 + (age > 50 ? 5 : 0) + (sdbSeverity * 5);

        for (let i = 0; i < numMicroArousals; i++) {
            const wakeT = latency + Math.random() * (currentTime - latency); // Distribute across total time
            wakeEvents.push({ time: wakeT, duration: 1 }); // 1 min micro-arousal
        }

        // 5. Post-Processing
        let startTimeOffset = 0;
        if (chronotype === 'lark') startTimeOffset = -120;
        if (chronotype === 'owl') startTimeOffset = 180;
        if (socialJetLag) startTimeOffset += bedtimeShift;

        // Metrics Calculation
        // TST = Pure Sleep Time (calculated from blocks excluding Wake)
        // TIB = Total Time in Bed (currentTime)
        // SE = TST / TIB

        // Recalculate actual TST from blocks
        const actualTST = blocks.reduce((sum, b) => (b.stage !== STAGES.WAKE ? sum + b.duration : sum), 0);
        const tib = currentTime;
        const sleepEfficiency = (actualTST / tib) * 100;

        return {
            blocks: blocks.map(b => ({ ...b, start: b.start + 240 + startTimeOffset })),
            wakeEvents: wakeEvents.map(w => ({ ...w, time: w.time + 240 + startTimeOffset })),
            params: { chronotype, startTimeOffset, tst: actualTST, tib }, // Pass TIB for marker
            stats: { n3P, remP, n1P, n2P, wasoMins, tst: actualTST, tib, sleepEfficiency, latency }
        };
    }
}

class TwoProcessModel {
    static getCurves(tst, chronotype, caffeine, caffeineTime, caffeineMetabolism, blueLight) {
        const tau_r = 18.2 * 60;
        const tau_d = 4.2 * 60;

        let peakTime = 240 + 180;
        if (chronotype === 'lark') peakTime -= 120;
        if (chronotype === 'owl') peakTime += 180;

        if (blueLight) peakTime += 60;

        let halfLife = 6;
        if (caffeineMetabolism === 'fast') halfLife = 4;
        if (caffeineMetabolism === 'slow') halfLife = 8;

        return { tau_r, tau_d, peakTime, caffeine, caffeineTime, halfLife };
    }
}

// --- APP LOGIC ---

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Loaded');
    const generator = new HypnogramGenerator();
    const canvas = document.getElementById('hypnogram');
    if (!canvas) console.error('Main Canvas Not Found');
    const ctx = canvas.getContext('2d');

    // State
    const state = {
        gender: 'male',
        age: 25,
        jetLag: 'none',
        socialJetLag: false,
        sdbSeverity: 0,
        isMenopausal: false,
        chronotype: 'normal',
        alcohol: 0,
        caffeine: 0,
        caffeineTime: 0, // Hours before bed
        caffeineMetabolism: 'normal', // fast, normal, slow
        nocturia: 0,
        blueLight: false, // New
        showProcessS: false,
        showProcessC: false
    };

    // Global update function
    window.updateCounter = (key, change) => {
        state[key] = Math.max(0, Math.min(10, state[key] + change));
        document.getElementById(`${key}-display`).textContent = state[key];
        document.getElementById(`${key}-input`).value = state[key];
        update();
    };

    // Bind Controls
    const bind = (id, key, type = 'value') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(type === 'checkbox' ? 'change' : 'input', (e) => {
            state[key] = type === 'checkbox' ? e.target.checked : (type === 'value' ? e.target.value : parseInt(e.target.value));

            // Special handling for Caffeine Time display
            if (key === 'caffeineTime') {
                document.getElementById('caffeine-time-val').textContent = state.caffeineTime;
            }

            if (key === 'age') {
                document.getElementById('age-value').textContent = state.age;
                const menGrp = document.getElementById('menopause-group');
                if (state.age >= 40 && state.age <= 60 && state.gender === 'female') menGrp.style.display = 'block';
                else { menGrp.style.display = 'none'; state.isMenopausal = false; }
            }
            update();
        });
    };

    // Bind Gender Toggle
    document.querySelectorAll('input[name="gender"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.gender = e.target.value;
            // Re-trigger age logic for menopause visibility
            const menGrp = document.getElementById('menopause-group');
            if (state.age >= 40 && state.age <= 60 && state.gender === 'female') menGrp.style.display = 'block';
            else { menGrp.style.display = 'none'; state.isMenopausal = false; }
            update();
        });
    });

    // Bind Metabolism Toggle
    document.querySelectorAll('input[name="metabolism"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.caffeineMetabolism = e.target.value;
            update();
        });
    });

    bind('age-slider', 'age', 'int');
    bind('jetlag-select', 'jetLag');
    bind('social-jetlag-toggle', 'socialJetLag', 'checkbox');
    bind('sdb-slider', 'sdbSeverity', 'int');
    bind('menopause-toggle', 'isMenopausal', 'checkbox');
    bind('chronotype-select', 'chronotype');
    bind('nocturia-slider', 'nocturia', 'int');
    bind('process-s-toggle', 'showProcessS', 'checkbox');
    bind('process-c-toggle', 'showProcessC', 'checkbox');
    bind('caffeine-time-slider', 'caffeineTime', 'int');
    bind('blue-light-toggle', 'blueLight', 'checkbox');

    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        console.log('Canvas Resized:', canvas.width, canvas.height);
        update();
    }
    window.addEventListener('resize', resizeCanvas);

    function drawBackground(params, timeToX, padding, height) {
        // Draw "Ideal Sleep Window" based on Chronotype
        let start, end;
        if (params.chronotype === 'lark') { start = 120; end = 600; }
        else if (params.chronotype === 'owl') { start = 420; end = 900; }
        else { start = 240; end = 720; } // Normal

        const x1 = timeToX(start);
        const x2 = timeToX(end);

        // Draw Ideal Window (Green tint background)
        ctx.fillStyle = 'rgba(74, 222, 128, 0.05)';
        ctx.fillRect(x1, padding.top, x2 - x1, height);

        // Label
        ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("Ideal Sleep Window", x1 + (x2 - x1) / 2, padding.top - 10);

        // Draw Top Border
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, padding.top);
        ctx.lineTo(x2, padding.top);
        ctx.stroke();
    }

    function drawCurves(params, timeToX, padding, height, width) {
        // --- DRAW END OF SLEEP MARKER (TIB) ---
        // User Feedback: "End of sleep is end of sleep"
        // Must use TIB (Time in Bed) so marker aligns with the end of the blocks.
        const sleepStart = 240 + params.startTimeOffset;
        const sleepEnd = sleepStart + params.tib; // Use TIB!
        const xEnd = timeToX(sleepEnd);

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(xEnd, padding.top);
        ctx.lineTo(xEnd, height + padding.top);
        ctx.stroke();
        ctx.setLineDash([]); // Reset

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("End of Sleep", xEnd, padding.top - 20);
        ctx.font = '10px Inter';
        // Show TIB in hours
        ctx.fillText(`(${(params.tib / 60).toFixed(1)}h)`, xEnd, padding.top - 8);

        // --- DRAW TWO-PROCESS MODEL CURVES ---
        // Pass TIB as the duration for the model to ensure decay covers the whole night
        const models = TwoProcessModel.getCurves(params.tib, params.chronotype, state.caffeine, state.caffeineTime, state.caffeineMetabolism, state.blueLight);
        const totalMins = 1080; // 18:00 to 12:00

        // Process S (Adenosine) - Yellow
        if (state.showProcessS) {
            // 1. Draw Actual Adenosine (Dotted if caffeine present)
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)'; // Yellow transparent
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]); // Dotted

            // Simulation: 
            // 07:00 Wake (approx) -> Rise until Sleep Start -> Decay until Sleep End
            const hoursAwakeBeforeStart = 11;
            const S_start = 1 - Math.exp(-(hoursAwakeBeforeStart * 60) / models.tau_r); // Initial pressure at 18:00

            for (let t = 0; t <= totalMins; t += 5) {
                const x = timeToX(t);
                let S = 0;

                if (t < sleepStart) {
                    // Still awake, rising from S_start
                    // S(t) = 1 - (1 - S_start) * e^(-t/tau_r)
                    S = 1 - (1 - S_start) * Math.exp(-t / models.tau_r);
                } else if (t < sleepEnd) {
                    // Asleep, decaying
                    // S_onset at sleepStart
                    const S_onset = 1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r);
                    S = S_onset * Math.exp(-(t - sleepStart) / models.tau_d);
                } else {
                    // Awake again
                    const S_end = (1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r)) * Math.exp(-(sleepEnd - sleepStart) / models.tau_d);
                    S = 1 - (1 - S_end) * Math.exp(-(t - sleepEnd) / models.tau_r);
                }

                // Map S (0-1) to Y (height -> padding.top)
                // Inverted Y: 1 is top (padding.top), 0 is bottom (height + padding.top)
                const y = (height + padding.top) - (S * height * 0.9); // Scale 90%

                if (t === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]); // Reset

            // 2. Draw Effective Sleep Drive (Solid)
            // Effective = Actual - CaffeineBlock
            ctx.beginPath();
            ctx.strokeStyle = '#facc15'; // Solid Yellow
            ctx.lineWidth = 4; // Thicker for visibility
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;

            for (let t = 0; t <= totalMins; t += 5) {
                const x = timeToX(t);
                let S = 0;
                // Calculate Actual S first
                if (t < sleepStart) S = 1 - (1 - S_start) * Math.exp(-t / models.tau_r);
                else if (t < sleepEnd) {
                    const S_onset = 1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r);
                    S = S_onset * Math.exp(-(t - sleepStart) / models.tau_d);
                } else {
                    const S_end = (1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r)) * Math.exp(-(sleepEnd - sleepStart) / models.tau_d);
                    S = 1 - (1 - S_end) * Math.exp(-(t - sleepEnd) / models.tau_r);
                }

                // Apply Caffeine Block
                // Caffeine taken at 'caffeineTime' hours before bed.
                // Bedtime is 'sleepStart'.
                // Intake Time (in graph mins) = sleepStart - (caffeineTime * 60)
                const intakeTime = sleepStart - (models.caffeineTime * 60);

                let caffeineBlock = 0;
                if (models.caffeine > 0 && t >= intakeTime) {
                    // Cups * Decay
                    const timeSinceIntake = (t - intakeTime) / 60; // hours
                    caffeineBlock = (models.caffeine * 0.1) * Math.pow(0.5, timeSinceIntake / models.halfLife);
                }

                // Effective S cannot be less than 0
                let effectiveS = Math.max(0, S - caffeineBlock);

                const y = (height + padding.top) - (effectiveS * height * 0.9);
                if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0; // Reset

            // Legend Label
            ctx.fillStyle = '#facc15';
            ctx.fillText("Sleep Drive (S)", width - 50, padding.top + 20);
        }

        // Process C (Circadian) - Purple
        if (state.showProcessC) {
            ctx.beginPath();
            ctx.strokeStyle = '#a78bfa'; // Purple
            ctx.lineWidth = 4; // Thicker
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;

            for (let t = 0; t <= totalMins; t += 5) {
                const x = timeToX(t);
                // Cosine wave peaking at peakTime (low alertness = high pressure)
                // We want high value = high sleep pressure
                // Peak pressure at peakTime (3-4 AM)

                const period = 24 * 60;
                const phase = (t - models.peakTime) / period * 2 * Math.PI;
                const C = 0.5 + 0.4 * Math.cos(phase); // 0.1 to 0.9 range

                const y = (height + padding.top) - (C * height * 0.9);

                if (t === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#a78bfa';
            ctx.fillText("Circadian (C)", width - 50, padding.top + 40);
        }
    }

    // --- Visualization ---

    function drawPieChart(stats) {
        console.log('Drawing Pie Chart', stats);
        const canvas = document.getElementById('pie-chart');
        if (!canvas) { console.error('Pie Canvas not found'); return; }
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const radius = Math.min(width, height) / 2;
        const centerX = width / 2;
        const centerY = height / 2;

        ctx.clearRect(0, 0, width, height);

        const data = [
            { label: 'N3 (Deep)', value: stats.n3P, color: '#1d4ed8' },
            { label: 'REM', value: stats.remP, color: '#f59e0b' },
            { label: 'N2 (Light)', value: stats.n2P, color: '#3b82f6' },
            { label: 'N1 (Dozing)', value: stats.n1P, color: '#38bdf8' },
            { label: 'Wake', value: stats.wasoMins / stats.tst, color: '#ef4444' } // Approx
        ];

        // Normalize
        const total = data.reduce((sum, item) => sum + item.value, 0);
        let startAngle = -Math.PI / 2;

        data.forEach(slice => {
            const sliceAngle = (slice.value / total) * 2 * Math.PI;

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();

            ctx.fillStyle = slice.color;
            ctx.fill();

            startAngle += sliceAngle;
        });

        // Update Legend & Metrics
        const legendEl = document.getElementById('pie-legend');
        if (legendEl) {
            legendEl.innerHTML = data.map(d => `
                <div class="legend-item">
                    <div class="legend-color" style="background: ${d.color}"></div>
                    <span>${d.label}: ${Math.round((d.value / total) * 100)}%</span>
                </div>
            `).join('');
        }

        const metricsEl = document.getElementById('metrics-display');
        if (metricsEl) {
            // Color code efficiency
            const se = stats.sleepEfficiency;
            let seColor = '#4ade80'; // Green
            if (se < 85) seColor = '#facc15'; // Yellow
            if (se < 75) seColor = '#ef4444'; // Red

            metricsEl.innerHTML = `
                <div class="metric-card">
                    <div class="metric-value">${(stats.tib / 60).toFixed(1)}h</div>
                    <div class="metric-label">Time in Bed</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${(stats.tst / 60).toFixed(1)}h</div>
                    <div class="metric-label">Total Sleep</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" style="color: ${seColor}">${Math.round(se)}%</div>
                    <div class="metric-label">Efficiency</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${Math.round(stats.wasoMins + stats.latency)}m</div>
                    <div class="metric-label">Wake/Latency</div>
                </div>
            `;
        }
    }

    function drawHypnogram(simResult) {
        console.log('Drawing Hypnogram', simResult);
        const { blocks, wakeEvents, params, stats } = simResult;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const padding = { top: 50, right: 20, bottom: 40, left: 60 };
        const width = canvas.width - padding.left - padding.right;
        const height = canvas.height - padding.top - padding.bottom;

        // Y-Axis
        const stageY = {
            [0]: padding.top,
            [1]: padding.top + height * 0.25,
            [2]: padding.top + height * 0.5,
            [3]: padding.top + height * 0.75,
            [4]: padding.top + height
        };

        const stageColors = {
            [0]: '#ef4444', // Wake
            [1]: '#f59e0b', // REM
            [2]: '#38bdf8', // N1
            [3]: '#3b82f6', // N2
            [4]: '#1d4ed8'  // N3
        };

        // Time Axis (18:00 to 12:00 = 1080 mins)
        const totalGraphMins = 1080;
        const timeToX = (t) => padding.left + (t / totalGraphMins) * width;

        // 1. Draw Background (Ideal Window)
        drawBackground(params, timeToX, padding, height);

        // Grid & Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';

        for (let h = 0; h <= 18; h += 2) {
            const min = h * 60;
            const x = timeToX(min);
            let labelHour = (18 + h) % 24;
            let label = `${labelHour}:00`;
            ctx.fillText(label, x, canvas.height - 20);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, canvas.height - padding.bottom);
            ctx.stroke();
        }

        // Stage Labels
        ctx.textAlign = 'right';
        Object.keys(stageY).forEach(stage => {
            const y = stageY[stage];
            ctx.fillStyle = stageColors[stage];
            ctx.font = 'bold 11px Inter';
            ctx.fillText(["Wake", "REM", "N1", "N2", "N3"][stage], padding.left - 10, y + 4);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(canvas.width - padding.right, y);
            ctx.stroke();
        });

        // 2. Draw Blocks (Hypnogram)
        console.log('Drawing blocks:', blocks.length);
        blocks.forEach(block => {
            const x = timeToX(block.start);
            const w = timeToX(block.start + block.duration) - x;
            const y = stageY[block.stage];
            const h = (canvas.height - padding.bottom) - y;

            if (w < 1) return;

            // Gradient Fill
            const grad = ctx.createLinearGradient(x, y, x, canvas.height - padding.bottom);
            grad.addColorStop(0, stageColors[block.stage]);
            grad.addColorStop(1, 'transparent');

            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.6; // High visibility
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1.0;

            // Solid Top Bar
            ctx.fillStyle = stageColors[block.stage];
            ctx.fillRect(x, y - 1, w, 4);
        });

        // 3. Draw Wake Interruptions (Thin Lines)
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;

        wakeEvents.forEach(wake => {
            const x = timeToX(wake.time);

            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height + padding.top);
            ctx.strokeStyle = '#ef4444';
            ctx.stroke();
        });
        ctx.globalAlpha = 1.0;

        // 4. Draw Curves (Overlays) - ON TOP
        drawCurves(params, timeToX, padding, height);

        // Draw Pie Chart
        drawPieChart(stats);
    }

    function update() {
        console.log('Update called');
        try {
            const result = generator.generate(state);
            drawHypnogram(result);
        } catch (e) {
            console.error('Update failed:', e);
        }
    }

    resizeCanvas();
});
