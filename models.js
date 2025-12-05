/**
 * Sleep Age Simulator - Data Models
 * Phase 6: Scientific Block Engine
 * 
 * Philosophy: Explicit Block Generation based on Meta-Analysis Constants.
 * No probabilistic noise. Fragmentation is an overlay.
 */

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
        // 1. Total Sleep Time (Minutes)
        let tst = 0;
        if (age <= 5) tst = 660; // 11h
        else if (age <= 12) tst = 600; // 10h
        else if (age <= 18) tst = 540; // 9h
        else if (age <= 60) tst = 480 - ((age - 18) * 1.5); // 8h -> 7h
        else tst = 420; // 7h floor for elderly

        // 2. Sleep Architecture Percentages (Target)
        // N3: High in childhood, drops exponentially
        let n3P = 0;
        if (age <= 10) n3P = 0.25;
        else if (age <= 20) n3P = 0.20;
        else if (age <= 60) n3P = 0.20 - ((age - 20) * 0.004); // Drops to ~4% by 60
        else n3P = 0.02; // Floor

        // REM: Relatively stable, slight decline
        let remP = 0.25;
        if (age > 60) remP = 0.20;

        // WASO (Wake After Sleep Onset): Increases linearly
        // Minutes of wakefulness
        let wasoMins = 10;
        if (age > 20) wasoMins += (age - 20) * 1.5; // 80yo = ~100 mins wake

        // N1: Increases with age
        let n1P = 0.05 + (age / 100) * 0.10;

        // N2: The filler
        let n2P = 1.0 - (n3P + remP + n1P);

        return { tst, n3P, remP, n1P, n2P, wasoMins };
    }
}

class HypnogramGenerator {
    generate(config) {
        const { age, gender, alcohol, caffeine, sdbSeverity, nocturia, chronotype } = config;

        // 1. Get Base Profile
        const profile = ScientificConstants.getAgeProfile(age);
        let { tst, n3P, remP, n1P, n2P, wasoMins } = profile;

        // 2. Apply Modifiers to Targets

        // Gender: Men have less N3, more WASO
        if (gender === 'male' && age > 30) {
            n3P *= 0.7; // Significant N3 loss
            wasoMins *= 1.3; // More fragmentation
        }

        // Alcohol: Suppress REM, Increase WASO
        if (alcohol > 0) {
            remP *= Math.max(0.5, 1 - (alcohol * 0.1));
            wasoMins += alcohol * 15;
        }

        // Caffeine: Reduce N3, Increase Latency (handled later), Increase N1
        if (caffeine > 0) {
            n3P *= Math.max(0.5, 1 - (caffeine * 0.1));
            n1P += caffeine * 0.02;
        }

        // SDB: Massive N3 reduction, Massive WASO/N1 increase
        if (sdbSeverity > 0) {
            const factor = sdbSeverity / 10;
            n3P *= (1 - factor * 0.8);
            remP *= (1 - factor * 0.3);
            wasoMins += factor * 60;
            n1P += factor * 0.2;
        }

        // Nocturia: Adds specific wake events, adds to WASO
        if (nocturia > 0) {
            wasoMins += nocturia * 10;
        }

        // Recalculate N2 as filler to ensure sum = 1.0 (excluding WASO time)
        // Effective TST = TST - WASO
        const effectiveTST = tst - wasoMins;
        const totalP = n3P + remP + n1P;
        if (totalP > 0.9) { // Safety
            const scale = 0.9 / totalP;
            n3P *= scale; remP *= scale; n1P *= scale;
        }
        n2P = 1.0 - (n3P + remP + n1P);

        // 3. Generate Cycles (Block Engine)
        const cycleLength = 90; // mins
        const numCycles = Math.floor(effectiveTST / cycleLength);
        const blocks = [];
        let currentTime = 0;

        // Latency
        let latency = 15 + (age > 60 ? 10 : 0) + (caffeine * 15);
        if (alcohol > 0) latency = Math.max(5, latency - 10);

        blocks.push({ stage: STAGES.WAKE, duration: latency, start: 0 });
        currentTime += latency;

        for (let i = 0; i < numCycles; i++) {
            // Cycle Architecture:
            // Early cycles: N3 dominant
            // Late cycles: REM dominant

            const progress = i / numCycles; // 0 to 1

            // Local Cycle Percentages
            let localN3 = n3P * (1 - progress) * 2.0; // Boost early
            let localREM = remP * (0.5 + progress * 1.5); // Boost late

            // Normalize local cycle
            let localN2 = 1.0 - (localN3 + localREM);
            if (localN2 < 0) { // Clamp
                const overflow = -localN2;
                localN3 -= overflow / 2;
                localREM -= overflow / 2;
                localN2 = 0;
            }

            // Generate Blocks for this Cycle
            // Order: N1 -> N2 -> N3 -> N2 -> REM
            // We simplify to: N2 -> N3 -> N2 -> REM (N1 is transition noise)

            const cycleMins = cycleLength;

            // N3 Block
            if (localN3 > 0.05) {
                blocks.push({ stage: STAGES.N2, duration: cycleMins * 0.1, start: currentTime });
                currentTime += cycleMins * 0.1;

                blocks.push({ stage: STAGES.N3, duration: cycleMins * localN3, start: currentTime });
                currentTime += cycleMins * localN3;
            } else {
                // Replace N3 with N2 if negligible
                blocks.push({ stage: STAGES.N2, duration: cycleMins * (0.1 + localN3), start: currentTime });
                currentTime += cycleMins * (0.1 + localN3);
            }

            // N2 Bridge
            blocks.push({ stage: STAGES.N2, duration: cycleMins * (localN2 * 0.5), start: currentTime });
            currentTime += cycleMins * (localN2 * 0.5);

            // REM Block
            // Alcohol suppression check
            let thisRem = localREM;
            if (alcohol > 0 && i < 2) thisRem *= 0.2; // Suppress early

            blocks.push({ stage: STAGES.REM, duration: cycleMins * thisRem, start: currentTime });
            currentTime += cycleMins * thisRem;
        }

        // 4. Fragmentation Overlay (The "Thin Lines")
        // We generate a list of Wake Events to be drawn ON TOP of blocks
        const wakeEvents = [];
        const numWakeEvents = Math.floor(wasoMins / 2); // Avg 2 min wake

        for (let i = 0; i < numWakeEvents; i++) {
            // Random time after sleep onset
            const wakeT = latency + Math.random() * effectiveTST;
            wakeEvents.push({ time: wakeT, duration: 2 + Math.random() * 3 });
        }

        // Nocturia Events (Fixed spacing roughly)
        if (nocturia > 0) {
            for (let i = 1; i <= nocturia; i++) {
                const time = latency + (effectiveTST * (i / (nocturia + 1))) + (Math.random() * 30 - 15);
                wakeEvents.push({ time: time, duration: 10 }); // 10 min bathroom break
            }
        }

        // 5. Post-Processing
        let startTimeOffset = 0;
        if (chronotype === 'lark') startTimeOffset = -120;
        if (chronotype === 'owl') startTimeOffset = 180;

        return {
            blocks: blocks.map(b => ({ ...b, start: b.start + 240 + startTimeOffset })),
            wakeEvents: wakeEvents.map(w => ({ ...w, time: w.time + 240 + startTimeOffset })),
            params: { chronotype, startTimeOffset },
            stats: { n3P, remP, n1P, n2P, wasoMins, tst } // For Pie Chart
        };
    }
}
