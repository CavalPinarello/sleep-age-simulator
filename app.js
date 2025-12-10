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
    static getAgeProfile(age) {
        // Helper: Linear Interpolation between Keyframes
        const interpolate = (val, keyframes) => {
            if (val <= keyframes[0][0]) return keyframes[0][1];
            if (val >= keyframes[keyframes.length - 1][0]) return keyframes[keyframes.length - 1][1];

            for (let i = 0; i < keyframes.length - 1; i++) {
                const [a1, v1] = keyframes[i];
                const [a2, v2] = keyframes[i + 1];
                if (val >= a1 && val <= a2) {
                    const t = (val - a1) / (a2 - a1);
                    return v1 + t * (v2 - v1);
                }
            }
            return keyframes[keyframes.length - 1][1];
        };

        // 1. Total Sleep Time (Minutes) - Aggressive Tuning
        // Age 0: 16h (960m)
        // Age 5: 11.5h (690m)
        // Age 12: 9.5h (570m)
        // Age 18: 8.0h (480m)
        // Age 40: 7.2h (432m)
        // Age 60: 6.0h (360m)
        // Age 80: 5.2h (312m) !! Aggressive Drop
        // Age 90: 5.0h (300m)
        const tstKeyframes = [
            [0, 960],
            [5, 690],
            [12, 570],
            [18, 480],
            [40, 432],
            [60, 360],
            [80, 312],
            [90, 300]
        ];
        const tst = interpolate(age, tstKeyframes);

        // 2. Deep Sleep (N3) %
        // High in childhood, drops in teens, stabilizes, drops in old age but NOT to zero.
        const n3Keyframes = [
            [0, 0.25],
            [10, 0.25],
            [18, 0.22], // Puberty drop
            [40, 0.18],
            [60, 0.15],
            [80, 0.12], // Kept reasonable
            [100, 0.10]
        ];
        let n3P = interpolate(age, n3Keyframes);

        // 3. REM %
        // Newborns have huge REM (50%). Drops to 25% by age 3-5. Stable 20-25% adult.
        const remKeyframes = [
            [0, 0.50],
            [3, 0.30],
            [5, 0.25],
            [60, 0.23],
            [80, 0.20],
            [100, 0.18]
        ];
        let remP = interpolate(age, remKeyframes);

        // 4. WASO (Wake After Sleep Onset) - Minutes
        // 20yo: 10m. 80yo: 120m (Aggressive fragmentation).
        const wasoKeyframes = [
            [0, 5],
            [30, 20],
            [50, 45],
            [70, 80],
            [80, 120],
            [90, 150]
        ];
        let wasoMins = interpolate(age, wasoKeyframes);

        // 5. N1 (Light Sleep)
        // Increases with age as Deep decreases.
        const n1Keyframes = [
            [0, 0.05],
            [50, 0.05],
            [80, 0.10],
            [100, 0.12]
        ];
        let n1P = interpolate(age, n1Keyframes);

        // N2: The filler
        let n2P = 1.0 - (n3P + remP + n1P);

        // Safety normalization
        if (n2P < 0) {
            const sum = n3P + remP + n1P;
            n3P = n3P / sum * 0.95;
            remP = remP / sum * 0.95;
            n1P = n1P / sum * 0.95;
            n2P = 0.05;
        }

        return { tst, n3P, remP, n1P, n2P, wasoMins };
    }
}

class HypnogramGenerator {
    generate(config) {
        const {
            age, gender, alcohol = 0, caffeine = 0, caffeineTime = 0,
            caffeineMetabolism = 'normal', sdbSeverity = 0, nocturia = 0,
            chronotype = 'normal', socialJetLag = false, blueLight = false,
            isMenopausal = false
        } = config;

        // 1. Get Base Profile
        const profile = ScientificConstants.getAgeProfile(age);
        let { tst, n3P, remP, n1P, n2P, wasoMins } = profile;

        // --- ADVANCED MODIFIERS ---

        // 0. Blue Light (Screens)
        let blueLightLatency = 0;
        if (blueLight) {
            blueLightLatency = 45;
            tst -= 30;
            n3P *= 0.85;
            remP *= 0.9;
            n1P += 0.03;
        }

        // 1. Caffeine Model
        let halfLife = 6;
        if (caffeineMetabolism === 'fast') halfLife = 4;
        if (caffeineMetabolism === 'slow') halfLife = 8;
        const activeCaffeine = caffeine * Math.pow(0.5, caffeineTime / halfLife);

        if (activeCaffeine > 0.1) {
            n3P *= Math.max(0.5, 1 - (activeCaffeine * 0.15));
            n1P += activeCaffeine * 0.03;
            // Caffeine Penalties (Corrected)
            tst -= activeCaffeine * 15; // Reduce total sleep by 15m per cup equivalent
            wasoMins += activeCaffeine * 15; // Increase fragmentation
        }

        // 2. Alcohol Model
        if (alcohol > 0) {
            n3P *= Math.max(0.6, 1 - (alcohol * 0.1));
            remP *= Math.max(0.4, 1 - (alcohol * 0.15));
            wasoMins += alcohol * 25;
        }

        // 3. Social Jet Lag
        let bedtimeShift = 0;
        if (socialJetLag) {
            bedtimeShift = 180;
            tst -= 60;
            n3P *= 0.85;
            remP *= 0.8;
            wasoMins += 30;
        }

        // Gender Diff
        if (gender === 'male' && age > 30) {
            // Slight fragmentation penalty
            wasoMins *= 1.1;
        }

        // Menopause
        if (config.isMenopausal) {
            wasoMins += 45;
            n3P *= 0.80;
            remP *= 0.9;
            n1P += 0.05;
        }

        // Elderly Phase Shift (Restored)
        let agePhaseShift = 0;
        if (age > 65) {
            // Linear shift from 65 (0) to 85 (-120)
            const elderlyFactor = Math.min(1, (age - 65) / 20);
            agePhaseShift = -120 * elderlyFactor;
        }

        // SDB (Sleep Apnea) - CALIBRATED
        // Goal: SDB 10 @ 35yo ≈ Healthy @ 80yo
        if (sdbSeverity > 0) {
            const factor = sdbSeverity / 10; // 0 to 1

            // N3: 35yo has ~15-20%. 80yo has ~5%.
            // We need to reduce it by ~75% at max severity.
            n3P *= (1 - factor * 0.75);

            // REM: Fragmented.
            remP *= (1 - factor * 0.3);

            // WASO: 35yo has ~20m. 80yo has ~90m. Diff = 70m.
            // Add up to 80m linear.
            wasoMins += factor * 80;

            // N1 (Micro-arousals): Massive increase.
            n1P += factor * 0.15;

            // TST penalty (Apnea shortens sleep)
            tst -= factor * 60;
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

        // 3. Generate Cycles (Continuous Engine)
        // FIX: Replaced integer cycle count with continuous loop to prevent jumps.

        const cycleLength = 90;
        const blocks = [];
        let currentTime = 0;

        // Latency
        // Continuous age-based latency: 10m baseline + age increases (Ohayon 2004)
        let latency = 10 + Math.max(0, (age - 20) * 0.25) + (activeCaffeine * 20) + blueLightLatency;
        if (alcohol > 0) latency = Math.max(5, latency - (alcohol * 5));
        if (config.isMenopausal) latency += 15; // Difficulty falling asleep

        blocks.push({ stage: STAGES.WAKE, duration: latency, start: 0 });
        currentTime += latency;

        // Initial N1
        const initialN1 = 5 + (age > 50 ? 5 : 0) + (activeCaffeine * 5);
        blocks.push({ stage: STAGES.N1, duration: initialN1, start: currentTime });
        currentTime += initialN1;

        // Calculate Wake Injection Points
        const numWakeChunks = Math.max(1, Math.floor(wasoMins / 15));
        const wakeChunkDuration = wasoMins / numWakeChunks;
        const wakeInsertionIndices = [];
        // Estimate max cycles for distribution
        const estCycles = Math.ceil(tst / cycleLength);
        for (let k = 0; k < numWakeChunks; k++) {
            wakeInsertionIndices.push(Math.floor(Math.random() * estCycles));
        }
        wakeInsertionIndices.sort((a, b) => a - b);
        let wakeChunkIndex = 0;

        // CONTINUOUS LOOP
        // We run until we have generated enough *Sleep* (non-wake) time to match TST.
        // We track 'accumulatedSleep' separately from 'currentTime' (which includes Waso).

        // Initialize accumulatedSleep with the Initial N1 we already added
        let accumulatedSleep = initialN1;
        let cycleIndex = 0;

        while (accumulatedSleep < tst) {
            const cycleProgress = Math.min(1, cycleIndex / 5); // Cap aging effect at 5 cycles

            // Local Cycle Percentages
            // First cycles have more N3. Later have more REM.
            let localN3 = n3P * (1 - (cycleIndex * 0.15)) * 2.0;
            // Dampen N3 decay slightly so it doesn't vanish too fast

            let localREM = remP * (0.5 + (cycleIndex * 0.20) * 1.5);
            // Increase REM in later cycles

            // Alcohol Logic
            if (alcohol > 0) {
                if (cycleIndex < 2) {
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
                const total = localN3 + localREM;
                localN3 = (localN3 / total) * 0.9;
                localREM = (localREM / total) * 0.9;
                localN2 = 0.1;
            }

            // Determine Cycle Duration
            // The last cycle might be partial if we only need a few minutes to hit TST.
            let remainingSleep = tst - accumulatedSleep;
            let currentCycleSleep = Math.min(cycleLength, remainingSleep);

            // If it's a tiny sliver (< 10 mins), maybe just skip it or merge? 
            // Better to show it for exactness.

            // Distribute currentCycleSleep into stages
            // N2 Bridge (Pre) - 40% of N2
            const dN2Pre = currentCycleSleep * (localN2 * 0.4);
            blocks.push({ stage: STAGES.N2, duration: dN2Pre, start: currentTime });
            currentTime += dN2Pre;
            accumulatedSleep += dN2Pre;

            // N3
            if (localN3 > 0.01) {
                const dN3 = currentCycleSleep * localN3;
                blocks.push({ stage: STAGES.N3, duration: dN3, start: currentTime });
                currentTime += dN3;
                accumulatedSleep += dN3;
            }

            // N2 Bridge (Post) - 60% of N2
            const dN2Post = currentCycleSleep * (localN2 * 0.6);
            blocks.push({ stage: STAGES.N2, duration: dN2Post, start: currentTime });
            currentTime += dN2Post;
            accumulatedSleep += dN2Post;

            // REM
            const dREM = currentCycleSleep * localREM;
            blocks.push({ stage: STAGES.REM, duration: dREM, start: currentTime });
            currentTime += dREM;
            accumulatedSleep += dREM;

            // Post-REM N1 (Transition) - only if full cycle
            if (currentCycleSleep >= cycleLength * 0.9) {
                const transN1 = 2 + (age > 50 ? 2 : 0);
                // Note: This adds to TST? Yes, N1 is sleep.
                blocks.push({ stage: STAGES.N1, duration: transN1, start: currentTime });
                currentTime += transN1;
                accumulatedSleep += transN1;
            }

            // --- INJECT REAL WAKE BLOCKS (WASO) ---
            // These do NOT count towards accumulatedSleep
            while (wakeChunkIndex < wakeInsertionIndices.length && wakeInsertionIndices[wakeChunkIndex] === cycleIndex) {
                blocks.push({ stage: STAGES.WAKE, duration: wakeChunkDuration, start: currentTime });
                currentTime += wakeChunkDuration;
                wakeChunkIndex++;
            }

            cycleIndex++;
        }

        // 4. Fragmentation Overlay (Thin Lines)
        // These are MICRO-arousals (don't add time, just paint over)
        // We reduced WASO by converting it to blocks, but we can keep some micro-arousals for visual texture.
        const wakeEvents = [];
        // SEVERE APNEA TEXTURE: Increase micro-arousals significantly
        const numMicroArousals = 5 + (age > 50 ? 5 : 0) + (sdbSeverity * 15);

        for (let i = 0; i < numMicroArousals; i++) {
            const wakeT = latency + Math.random() * (currentTime - latency); // Distribute across total time
            wakeEvents.push({ time: wakeT, duration: 1 }); // 1 min micro-arousal
        }

        // 5. Post-Processing
        let startTimeOffset = 0;
        if (chronotype === 'lark') startTimeOffset = -120;
        if (chronotype === 'owl') startTimeOffset = 180;
        if (socialJetLag) startTimeOffset += bedtimeShift;
        startTimeOffset += agePhaseShift; // Apply elderly shift

        // Teenage Phase Delay (Biological)
        // Teens naturally want to go to bed later.
        let teenShift = 0;
        if (age >= 13 && age <= 21) {
            // Peak at 17-19
            if (age <= 17) {
                // 13 -> 17: Ramp up 0 -> 90
                teenShift = ((age - 13) / 4) * 90;
            } else {
                // 17 -> 21: Ramp down 90 -> 0
                teenShift = 90 - ((age - 17) / 4) * 90;
            }
        }
        startTimeOffset += teenShift;

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

    // Canvas References
    const canvasA = document.getElementById('hypnogram');
    const canvasB = document.getElementById('hypnogram-b');
    const pieCanvasA = document.getElementById('pie-chart');
    const pieCanvasB = document.getElementById('pie-chart-b');

    // Default State Template
    const defaultState = {
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
        blueLight: false,
        showProcessS: false,
        showProcessC: false,
        showGH: false,
        showCortisol: false
    };

    // Global State
    const states = {
        A: JSON.parse(JSON.stringify(defaultState)),
        B: JSON.parse(JSON.stringify(defaultState))
    };

    let activeProfile = 'A';
    let compareMode = false;
    let cachedSimulations = { A: null, B: null };

    // --- State Management ---

    function switchProfile(profileId) {
        activeProfile = profileId;

        // Update Tabs UI
        document.querySelectorAll('.profile-tabs .tab').forEach(t => {
            t.classList.toggle('active', t.dataset.profile === profileId);
        });

        // Update Sidebar styling
        const mask = document.getElementById('controls-mask');
        if (mask) {
            mask.className = '';
            mask.classList.add(`profile-${profileId.toLowerCase()}-active`);
        }

        // Update Inputs to match State
        updateInputsFromState(states[activeProfile]);
    }

    function updateInputsFromState(s) {
        // Values
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        const setChk = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        setVal('age-slider', s.age);
        setTxt('age-value', s.age);

        // Gender Radios
        document.querySelectorAll('input[name="gender"]').forEach(r => {
            r.checked = (r.value === s.gender);
        });

        setVal('chronotype-select', s.chronotype);
        setVal('jetlag-select', s.jetLag);
        setChk('social-jetlag-toggle', s.socialJetLag);

        setTxt('alcohol-display', s.alcohol);
        setVal('alcohol-input', s.alcohol); // Hidden input for counter logic

        setTxt('caffeine-display', s.caffeine);
        setVal('caffeine-input', s.caffeine);

        setVal('caffeine-time-slider', s.caffeineTime);
        setTxt('caffeine-time-val', s.caffeineTime);

        document.querySelectorAll('input[name="metabolism"]').forEach(r => {
            r.checked = (r.value === s.caffeineMetabolism);
        });

        setTxt('nocturia-display', s.nocturia);
        setVal('nocturia-input', s.nocturia);

        setChk('blue-light-toggle', s.blueLight);
        setVal('sdb-slider', s.sdbSeverity);
        setChk('menopause-toggle', s.isMenopausal);

        // Menopause Visibility
        const menGrp = document.getElementById('menopause-group');
        if (s.age >= 40 && s.age <= 60 && s.gender === 'female') menGrp.style.display = 'block';
        else menGrp.style.display = 'none';

        // Overlays
        setChk('process-s-toggle', s.showProcessS);
        setChk('process-c-toggle', s.showProcessC);
        setChk('gh-toggle', s.showGH);
        setChk('cortisol-toggle', s.showCortisol);
    }

    // --- Interaction ---

    // Toggle Compare Mode
    const compareToggle = document.getElementById('compare-mode-toggle');
    if (compareToggle) {
        compareToggle.addEventListener('change', (e) => {
            compareMode = e.target.checked;
            document.body.classList.toggle('compare-active', compareMode);

            const tabs = document.getElementById('profile-tabs');
            const vizB = document.getElementById('viz-b');

            if (compareMode) {
                tabs.style.display = 'flex';
                vizB.style.display = 'flex';
                // Trigger resize after layout reflow
                setTimeout(() => {
                    resizeAll();
                    runSimulation('B');
                }, 50);
            } else {
                tabs.style.display = 'none';
                vizB.style.display = 'none';
                switchProfile('A'); // Force back to A
                // Trigger resize after layout reflow
                setTimeout(() => {
                    resizeAll();
                }, 50);
            }

            // Toggle Label A Visibility
            const labelA = document.querySelector('#viz-a .viz-label');
            if (labelA) labelA.style.display = compareMode ? 'block' : 'none';
        });
    }

    // Profile Tabs
    document.querySelectorAll('.profile-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchProfile(tab.dataset.profile);
        });
    });

    // Update Counter (Global Helper Override)
    window.updateCounter = (key, change) => {
        const s = states[activeProfile];
        s[key] = Math.max(0, Math.min(10, s[key] + change));

        // Update UI
        document.getElementById(`${key}-display`).textContent = s[key];
        document.getElementById(`${key}-input`).value = s[key];

        runSimulation(activeProfile);
    };

    // Bind Controls
    const bind = (id, key, type = 'value') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(type === 'checkbox' ? 'change' : 'input', (e) => {
            const val = type === 'checkbox' ? e.target.checked : (type === 'value' ? e.target.value : parseInt(e.target.value));
            states[activeProfile][key] = val;

            // Specific UI logic
            if (key === 'caffeineTime') {
                document.getElementById('caffeine-time-val').textContent = val;
            }
            if (key === 'age' || key === 'gender') { // Gender handled separately but age needs check
                const s = states[activeProfile];
                document.getElementById('age-value').textContent = s.age;
                const menGrp = document.getElementById('menopause-group');
                if (s.age >= 40 && s.age <= 60 && s.gender === 'female') menGrp.style.display = 'block';
                else { menGrp.style.display = 'none'; s.isMenopausal = false; }
            }

            // Visual-only check
            const isVisual = ['showProcessS', 'showProcessC', 'showGH', 'showCortisol'].includes(key);
            if (isVisual) {
                drawVisuals(activeProfile);
            } else {
                runSimulation(activeProfile);
            }
        });
    };

    // Bind Gender/Metabolism (Radios)
    const bindRadios = (name, key) => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                states[activeProfile][key] = e.target.value;
                if (key === 'gender') {
                    const s = states[activeProfile];
                    const menGrp = document.getElementById('menopause-group');
                    if (s.age >= 40 && s.age <= 60 && s.gender === 'female') menGrp.style.display = 'block';
                    else { menGrp.style.display = 'none'; s.isMenopausal = false; }
                }
                runSimulation(activeProfile);
            });
        });
    };

    bind('age-slider', 'age', 'int');
    bind('jetlag-select', 'jetLag');
    bind('social-jetlag-toggle', 'socialJetLag', 'checkbox');
    bind('sdb-slider', 'sdbSeverity', 'int');
    bind('menopause-toggle', 'isMenopausal', 'checkbox');
    bind('chronotype-select', 'chronotype');
    bind('nocturia-slider', 'nocturia', 'int'); // Wait, ID was nocturia-slider? 
    // Checking index.html... no, nocturia is counter buttons. BUT I saw bind('nocturia-slider'...) in old code.
    // Index.html has buttons. bind() here is for range/select/check. 
    // Counters uses updateCounter.

    bind('process-s-toggle', 'showProcessS', 'checkbox');
    bind('process-c-toggle', 'showProcessC', 'checkbox');
    bind('gh-toggle', 'showGH', 'checkbox');
    bind('cortisol-toggle', 'showCortisol', 'checkbox');
    bind('caffeine-time-slider', 'caffeineTime', 'int');
    bind('blue-light-toggle', 'blueLight', 'checkbox');

    bindRadios('gender', 'gender');
    bindRadios('metabolism', 'caffeineMetabolism');


    // --- Graphics ---

    function resizeAll() {
        resizeCanvas('A');
        resizeCanvas('B');
    }

    function resizeCanvas(profileId) {
        const c = profileId === 'A' ? canvasA : canvasB;
        if (!c || c.style.display === 'none') return;

        // We need to fit container
        const container = c.parentElement;
        c.width = container.clientWidth;
        c.height = container.clientHeight;

        drawVisuals(profileId);
    }

    window.addEventListener('resize', resizeAll);

    // Re-implemented drawing functions to use passed CTX
    function drawBackground(ctx, params, timeToX, padding, height, viewStart, viewEnd) {
        let start, end;
        if (params.chronotype === 'lark') { start = 120; end = 600; }
        else if (params.chronotype === 'owl') { start = 420; end = 900; }
        else { start = 240; end = 720; }

        const x1 = Math.max(padding.left, timeToX(start));
        const x2 = Math.min(ctx.canvas.width - padding.right, timeToX(end));

        if (x2 > x1) {
            ctx.fillStyle = 'rgba(74, 222, 128, 0.05)';
            ctx.fillRect(x1, padding.top, x2 - x1, height);

            // Only draw label if visible
            if (x1 < ctx.canvas.width - padding.right && x2 > padding.left) {
                ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
                ctx.font = '10px Inter';
                ctx.textAlign = 'center';
                const labelX = (x1 + x2) / 2;
                if (labelX > padding.left && labelX < ctx.canvas.width - padding.right) {
                    ctx.fillText("Ideal Sleep Window", labelX, padding.top - 10);
                }
            }

            ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, padding.top);
            ctx.lineTo(x2, padding.top);
            ctx.stroke();
        }
    }

    function drawCurves(ctx, params, state_local, timeToX, padding, height, width, viewStart, viewEnd) {
        // TIB Marker
        const sleepStart = 240 + params.startTimeOffset;
        const sleepEnd = sleepStart + params.tib;

        if (sleepEnd >= viewStart && sleepEnd <= viewEnd) {
            const xEnd = timeToX(sleepEnd);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(xEnd, padding.top);
            ctx.lineTo(xEnd, height + padding.top);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'center';
            // Clamp text to canvas logic? Nah, usually TIB is end of graph now.
            ctx.fillText("End of Sleep", xEnd, padding.top - 20);
            ctx.font = '10px Inter';
            ctx.fillText(`(${(params.tib / 60).toFixed(1)}h)`, xEnd, padding.top - 8);
        }

        // Models
        const models = TwoProcessModel.getCurves(params.tib, params.chronotype, state_local.caffeine, state_local.caffeineTime, state_local.caffeineMetabolism, state_local.blueLight);

        // Process S
        if (state_local.showProcessS) {
            const hoursAwakeBeforeStart = 11;
            const S_start = 1 - Math.exp(-(hoursAwakeBeforeStart * 60) / models.tau_r);

            ctx.beginPath();
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 4;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;

            let first = true;
            for (let t = Math.floor(viewStart); t <= Math.ceil(viewEnd); t += 5) {
                const x = timeToX(t);
                let S = 0;
                if (t < sleepStart) S = 1 - (1 - S_start) * Math.exp(-t / models.tau_r);
                else if (t < sleepEnd) {
                    const S_onset = 1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r);
                    S = S_onset * Math.exp(-(t - sleepStart) / models.tau_d);
                } else {
                    const S_end = (1 - (1 - S_start) * Math.exp(-sleepStart / models.tau_r)) * Math.exp(-(sleepEnd - sleepStart) / models.tau_d);
                    S = 1 - (1 - S_end) * Math.exp(-(t - sleepEnd) / models.tau_r);
                }

                // Caffeine Block
                const intakeTime = sleepStart - (models.caffeineTime * 60);
                let caffeineBlock = 0;
                if (models.caffeine > 0 && t >= intakeTime) {
                    const timeSinceIntake = (t - intakeTime) / 60;
                    caffeineBlock = (models.caffeine * 0.1) * Math.pow(0.5, timeSinceIntake / models.halfLife);
                }

                let effectiveS = Math.max(0, S - caffeineBlock);
                const y = (height + padding.top) - (effectiveS * height * 0.9);
                if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#facc15';
            ctx.fillText("Sleep Drive (S)", width - 50, padding.top + 20);
        }

        // Process C
        if (state_local.showProcessC) {
            ctx.beginPath();
            ctx.strokeStyle = '#a78bfa';
            ctx.lineWidth = 4;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;

            let first = true;
            for (let t = Math.floor(viewStart); t <= Math.ceil(viewEnd); t += 5) {
                const x = timeToX(t);
                const period = 24 * 60;
                const phase = (t - models.peakTime) / period * 2 * Math.PI;
                const C = 0.5 + 0.4 * Math.cos(phase);
                const y = (height + padding.top) - (C * height * 0.9);
                if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    function drawHormones(ctx, params, state_local, timeToX, padding, height, width, viewStart, viewEnd) {
        const sleepStart = 240 + params.startTimeOffset;
        const sleepEnd = sleepStart + params.tib;

        if (state_local.showGH) {
            ctx.beginPath();
            ctx.strokeStyle = '#2dd4bf';
            ctx.lineWidth = 3;
            ctx.shadowColor = 'rgba(45, 212, 191, 0.5)';
            ctx.shadowBlur = 8;
            let first = true;
            for (let t = Math.floor(viewStart); t <= Math.ceil(viewEnd); t += 5) {
                const x = timeToX(t);
                let gh = 0.1;
                if (t >= sleepStart && t <= sleepEnd) {
                    const timeAsleep = t - sleepStart;
                    const peak = 70; const sigma = 25;
                    const pulse = Math.exp(-Math.pow(timeAsleep - peak, 2) / (2 * Math.pow(sigma, 2)));
                    gh += pulse * 0.8;
                }
                const y = (height + padding.top) - (gh * height * 0.9);
                if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        if (state_local.showCortisol) {
            ctx.beginPath();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 3;
            ctx.shadowColor = 'rgba(249, 115, 22, 0.5)';
            ctx.shadowBlur = 8;

            const wakeTime = sleepEnd;
            let first = true;
            for (let t = Math.floor(viewStart); t <= Math.ceil(viewEnd); t += 5) {
                const x = timeToX(t);
                let cort = 0.2;
                if (t < wakeTime - 180) { cort = 0.2; }
                else if (t <= wakeTime + 30) {
                    const progress = (t - (wakeTime - 180)) / 210;
                    cort = 0.2 + (0.7 * Math.pow(progress, 2));
                } else {
                    const timeSincePeak = t - (wakeTime + 30);
                    cort = 0.9 * Math.exp(-timeSincePeak / 180);
                }
                const y = (height + padding.top) - (cort * height * 0.9);
                if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    function drawHypnogram(ctx, canvas, simResult, state_local) {
        const { blocks, wakeEvents, params, stats } = simResult;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const padding = { top: 50, right: 30, bottom: 40, left: 60 };
        const width = canvas.width - padding.left - padding.right;
        const height = canvas.height - padding.top - padding.bottom;

        // Dynamic Viewport Calculation
        // Center on Sleep Period
        const sleepStart = 240 + params.startTimeOffset;
        const sleepEnd = sleepStart + params.tib;

        let viewStart = sleepStart - 60; // 1h buffer before
        let viewEnd = sleepEnd + 60;     // 1h buffer after

        // Ensure minimum duration (e.g. 10 hours) to prevent excessive zoom
        const minDuration = 600;
        const currentDuration = viewEnd - viewStart;
        if (currentDuration < minDuration) {
            const extra = minDuration - currentDuration;
            viewStart -= extra / 2;
            viewEnd += extra / 2;
        }

        const totalViewMins = viewEnd - viewStart;
        const timeToX = (t) => padding.left + ((t - viewStart) / totalViewMins) * width;

        const stageY = {
            [0]: padding.top,
            [1]: padding.top + height * 0.20,
            [2]: padding.top + height * 0.40,
            [3]: padding.top + height * 0.60,
            [4]: padding.top + height * 0.80
        };
        const stageColors = {
            [0]: '#ef4444',
            [1]: '#f59e0b',
            [2]: '#38bdf8',
            [3]: '#3b82f6',
            [4]: '#1d4ed8'
        };

        drawBackground(ctx, params, timeToX, padding, height, viewStart, viewEnd);

        // Grid
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';

        // Determine grid step based on zoom? 
        // 60 mins is usually fine for 10-12h view.

        // Align to nearest hour
        const startHourMins = Math.floor(viewStart / 60) * 60;

        for (let m = startHourMins; m <= viewEnd; m += 60) {
            if (m < viewStart) continue; // Skip if before start

            const x = timeToX(m);
            // Label logic: 0 = 18:00
            const hourAbsolute = (18 + Math.floor(m / 60)) % 24;
            const label = `${hourAbsolute}:00`;

            ctx.fillText(label, x, canvas.height - 20);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath(); ctx.moveTo(x, padding.top); ctx.lineTo(x, canvas.height - padding.bottom); ctx.stroke();
        }

        // Labels (Y-Axis)
        ctx.textAlign = 'right';
        Object.keys(stageY).forEach(stage => {
            const y = stageY[stage];
            ctx.fillStyle = stageColors[stage];
            ctx.font = 'bold 11px Inter';
            ctx.fillText(["Wake", "REM", "N1", "N2", "N3"][stage], padding.left - 10, y + 4);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(canvas.width - padding.right, y); ctx.stroke();
        });

        // Blocks
        blocks.forEach(block => {
            // Clip? Or just let canvas handle it (since timeToX can go out of bounds)
            // Canvas handles out of bounds drawing fine usually, but gradients might be weird.
            // Let's check overlaps.
            const bStart = block.start;
            const bEnd = block.start + block.duration;

            if (bEnd < viewStart || bStart > viewEnd) return; // Out of view

            const x = timeToX(Math.max(viewStart, bStart));
            const xEndBox = timeToX(Math.min(viewEnd, bEnd));
            const w = xEndBox - x;

            if (w < 0.5) return;

            const y = stageY[block.stage];
            const h = (canvas.height - padding.bottom) - y;

            const grad = ctx.createLinearGradient(x, y, x, canvas.height - padding.bottom);
            grad.addColorStop(0, stageColors[block.stage]);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = stageColors[block.stage];
            ctx.fillRect(x, y - 1, w, 4);
        });

        // Wake Events
        ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
        wakeEvents.forEach(wake => {
            if (wake.time < viewStart || wake.time > viewEnd) return;
            const x = timeToX(wake.time);
            ctx.beginPath(); ctx.moveTo(x, padding.top); ctx.lineTo(x, height + padding.top);
            ctx.strokeStyle = '#ef4444'; ctx.stroke();
        });
        ctx.globalAlpha = 1.0;

        drawCurves(ctx, params, state_local, timeToX, padding, height, width, viewStart, viewEnd);
        drawHormones(ctx, params, state_local, timeToX, padding, height, width, viewStart, viewEnd);
    }

    function drawPieChart(profileId, stats) {
        const c = profileId === 'A' ? pieCanvasA : pieCanvasB;
        if (!c) return;
        const ctx = c.getContext('2d');
        const width = c.width; const height = c.height;

        const radius = Math.min(width, height) / 2;
        const centerX = width / 2; const centerY = height / 2;

        ctx.clearRect(0, 0, width, height);
        const data = [
            { label: 'N3', value: stats.n3P, color: '#1d4ed8' },
            { label: 'REM', value: stats.remP, color: '#f59e0b' },
            { label: 'N2', value: stats.n2P, color: '#3b82f6' },
            { label: 'N1', value: stats.n1P, color: '#38bdf8' },
            { label: 'Wake', value: stats.wasoMins / stats.tst, color: '#ef4444' }
        ];

        const total = data.reduce((sum, item) => sum + item.value, 0);
        let startAngle = -Math.PI / 2;
        data.forEach(slice => {
            const sliceAngle = (slice.value / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fillStyle = slice.color; ctx.fill();
            startAngle += sliceAngle;
        });

        // HTML Metrics
        const suffix = profileId === 'A' ? '' : '-b';
        const legendEl = document.getElementById('pie-legend' + suffix);
        if (legendEl) {
            legendEl.innerHTML = data.map(d => `
                <div class="legend-item">
                    <div class="legend-color" style="background: ${d.color}"></div>
                    <span>${d.label}: ${Math.round((d.value / total) * 100)}%</span>
                </div>
            `).join('');
        }
        const metricsEl = document.getElementById('metrics-display' + suffix);
        if (metricsEl) {
            const se = stats.sleepEfficiency;
            const seColor = se < 75 ? '#ef4444' : (se < 85 ? '#facc15' : '#4ade80');
            metricsEl.innerHTML = `
                <div class="metric-card"><div class="metric-value">${(stats.tib / 60).toFixed(1)}h</div><div class="metric-label">Time in Bed</div></div>
                <div class="metric-card"><div class="metric-value">${(stats.tst / 60).toFixed(1)}h</div><div class="metric-label">Total Sleep</div></div>
                <div class="metric-card"><div class="metric-value" style="color: ${seColor}">${Math.round(se)}%</div><div class="metric-label">Efficiency</div></div>
                <div class="metric-card"><div class="metric-value">${Math.round(stats.latency)}m</div><div class="metric-label">Latency</div></div>
                <div class="metric-card"><div class="metric-value">${Math.round(stats.wasoMins)}m</div><div class="metric-label">WASO</div></div>
            `;
        }
    }

    function runSimulation(profileId) {
        if (!states[profileId]) return;
        try {
            cachedSimulations[profileId] = generator.generate(states[profileId]);
            drawVisuals(profileId);
        } catch (e) {
            console.error('Sim Error', e);
        }
    }

    function drawVisuals(profileId) {
        const result = cachedSimulations[profileId];
        if (!result) { runSimulation(profileId); return; }

        const c = profileId === 'A' ? canvasA : canvasB;
        if (!c) return;
        drawHypnogram(c.getContext('2d'), c, result, states[profileId]);
        drawPieChart(profileId, result.stats);
    }

    resizeAll();
    runSimulation('A');
});
