# Simulated-eye test bench

> **This is a simulation, not clinical validation.** Every "person" here is a set of numbers drawn from
> published age norms and stated assumptions. No real participant was tested. The bench tells us whether
> Small Print's algorithm is *internally consistent* and *how it degrades* under plausible noise; it cannot
> tell us how accurate the app is on real eyes. That needs a field study.

## Purpose

Small Print has no human test participants. This bench runs 20,000 virtual people aged 40–70 through:

| Method | What it is |
|---|---|
| **Age table (40 cm)** | Stevens 2019 age table, no measurement (`ageTableAdd40`). |
| **Age table + measured distance** | Same table shifted to the camera-measured working distance (`addForWorkingDistance`). |
| **Rack card at 14 in** | A printed card held exactly at 35.6 cm, as instructed. |
| **Rack card where they read** | The same card held around the person's own reading distance. |
| **Small Print start** | `recommend()` from `src/core/recommend.ts` on simulated noisy measurements. |
| **Small Print + try-on** | `recommend()`, then `assessTryOn()` from `src/core/tryon.ts` at a rack stocked in 0.50 or 0.25 steps, max 3 pairs. |
| What-if variants (**not shipped**) | Protocol or parameter changes, to give evidence for proposed fixes. |

Small Print's own functions are called unchanged. Each method's choice is scored against the person's
simulated ideal strength.

## How to run

```bash
npm run sim            # = npx tsx sim/bench.ts, about 5–10 s
npx vitest run tests/sim.test.ts
```

Outputs (overwritten on every run):

- `public/data/bench.json`: every number, plus config, seed, assumptions, timestamp, and a git-free version string (`bench <version> · core sha256:<hash of src/core/*.ts>`).
- `public/data/bench-summary.md`: compact tables.
- `public/figures/bench-accuracy.svg`, `bench-error-distribution.svg`, `bench-distance-error.svg`.

Seeded with mulberry32 (default seed `20261003`), so a run is reproducible to the last digit on any machine.
Every person is generated from their own seed stream. Sensitivity runs therefore use **the same virtual
people** and differ only in the parameter being varied.

## The model

### Optics (derivation)

Work in **vergence demand**: an object at distance *d* metres has demand *D* = 1/*d* dioptres (D).

- An eye with spherical refractive error **RE** (D, + = long-sighted/hyperopic, − = short-sighted/myopic) is, when relaxed, focused at demand *D* = −RE. An emmetrope focuses at infinity (0 D). A −2 D myope focuses at 50 cm (2 D). A +1 D hyperope "focuses beyond infinity" (−1 D), so they must accommodate 1 D just to see far away.
- Accommodating by *a* ∈ [0, **AA**] moves focus to *D* = *a* − RE.
- With total depth of focus **DOF**, an object stays acceptably sharp within ±DOF/2 of the focused demand.
- So without glasses, an object is clear iff −RE − DOF/2 ≤ *D* ≤ AA − RE + DOF/2.
- Readers of power **A** (thin lens at the eye, vertex distance ignored) reduce the demand reaching the eye to *D* − A. Clear iff

  **A − RE − DOF/2 ≤ D ≤ A − RE + AA + DOF/2.**

- The clear range has width AA + DOF whatever the lens. Its middle, **M(A) = A − RE + AA/2**, moves one-for-one with A.
- **Ideal readers** put the working distance *W* in the middle (Stevens 2019: keep half the accommodation in reserve): M(A\*) = 1/*W*, so

  **A\* = 1/W + RE − AA/2**, rounded to 0.25 D.

  Hyperopes need RE more plus. Myopes need |RE| less.
- Real objects have *D* > 0. If the far limit A − RE − DOF/2 ≤ 0, the person sees clearly all the way to infinity with the readers on. This can only happen with weak readers or long sight.

### What the app's estimates actually measure

- **Push-up near point** (no glasses) gives the near limit AA − RE + DOF/2. `recommend()` subtracts DOF/2 = 0.25 D and halves the result. Its near-point estimate is therefore
  `fromNearPoint = A* − RE/2 − (DOF − 0.5)/4`.
  The near point cannot separate long sight from accommodation, so **uncorrected hyperopes start under-corrected by about RE/2** (and myopes over-corrected). This is inherent to any near-only test, not a coding bug.
- **Try-on** measures both limits with the pair on. Midpoint − 1/*W* = A − A\* exactly, and DOF cancels. This holds **only if the far limit is measurable**. When it is beyond arm's reach, `assessTryOn()` uses arm's length as the far end. That makes the estimated middle ≥ the true middle, so it can detect "too weak" but never "too strong", and it accepts a pair that is in fact too weak whenever the best case looks centred.

### Virtual population (main scenario)

| Quantity | Distribution | Source |
|---|---|---|
| Age | Uniform 40–70 y (supplementary run 35–39) | Assumption |
| Accommodation AA | Normal(Hofstetter mean 18.5 − 0.3·age, SD 0.75 D), clipped to [0, Hofstetter max 25 − 0.4·age] | Hofstetter HW, *Optom World* 1950;38:42–45 (fit to Duane's data). SD is an assumption: ±2 SD ≈ Hofstetter's min–max envelope at 45–50 |
| Refractive error RE | Mixture 72% N(+0.25, 0.5) · 16% N(+1.5, 1.0) · 12% N(−2.0, 1.25), clipped [−6, +5]. Realised: 10.2% below −1.00 D, 1.1% ≥ +3.00 D, mean +0.17 D | **Assumption.** Context: Kempen JH et al., *Arch Ophthalmol* 2004;122:495–505 (adults 40+: myopia ≤ −1 D ≈ 25%, hyperopia ≥ +3 D ≈ 10%). We use less myopia because people who already wear distance glasses are sent to an eye doctor by the safety questions. Our high-hyperopia share is lower than Kempen's |
| Depth of focus DOF | Uniform 0.3–1.0 D (pupil-dependent). App assumes 0.50 D | Wang B, Ciuffreda KJ, *Surv Ophthalmol* 2006;51:75–85 |
| Working distance W | Normal(37, 5) cm, clipped 25–55 cm | Bababekova Y et al., *Optom Vis Sci* 2011;88:795–797 (phones: 36.2 cm messages, 32.2 cm web). SD is an assumption |
| Arm's reach | Uniform 55–70 cm. Nothing farther can be measured. Closest measurable distance 12 cm | Assumption |

**Caveat on the accommodation norm.** Hofstetter/Duane norms come from subjective push-up tests, which already include part of the depth of focus. The main population may therefore have slightly too much accommodation, which makes the age table look too strong. A **lower-amplitude population** (centred on Hofstetter's minimum, 15 − 0.25·age) is run as a sensitivity case.

### Simulated measurements

| Source of error | Default | Source |
|---|---|---|
| Camera distance, **shared** per person (calibration / iris size) | relative SD 4% | Google MediaPipe Iris (2020): 4.3% mean relative depth error (SD 2.4%) before calibration. Ruler calibration should reduce it. Swept 0–8% |
| Camera distance, **per reading** (landmark jitter) | relative SD 1% | Assumption. Swept 0–8% as fully independent error |
| Judging where the E blurs, per limit (and per N6 check) | SD 0.25 D | Assumption. Swept 0–0.5 D |
| Holding variability, arm-stretch | off (sensitivity cases) | Assumption |

The no-glasses session simulates three measurements:

- Working distance: the camera measures where the phone is held.
- Push-up near point: judged near limit → distance → camera. "Beyond reach" if never clear within reach.
- The N6 check at W: readable if W is inside the judged clear range.

The try-on measures the near and far limits with the pair on. "Far limit = null" when the pair is still clear at arm's length. When a pair is never clear within reach, the near limit is reported as arm's length.

### Strategies: modelling choices

- **Rack protocol.** The first pair is the weaker of the app's two "try first" pairs (0.50 stock), or the starting strength itself (0.25 stock). Follow `assessTryOn()`'s suggested change, snapped to stock with at least one step. Stop at "good" or after 3 pairs; if none was "good", keep the best-centred pair. "Weaker" on +1.00 → no readers; "stronger" on +3.00 → refer. (Assumption about how people use the screen.)
- **Age table.** Never refers. Gives everyone 40+ at least +1.00.
- **Rack card.** Modelled as an *ideal blur meter*. The smallest readable line reports the dioptres of blur where the card is held, and the card labels it as blur + a fixed reserve. Reading the smallest line means "+1.00". Past +3.00 counts as refer. The card can't tell "too far for a myope" from "too close for a presbyope". The reserve (0.25 D) is **chosen to maximise the card's own score** on this population. The model also ignores how letter size changes with holding distance. Both choices are deliberately generous to the card.
- `recommend()` returning `no-readers` with a `possible-myopia` flag is scored as a referral.

### Scoring

- **In scope**: RE ≥ −1.00 D and A\* ∈ [+0.75, +3.00]. Refer if RE < −1.00 D (readers don't fix distance blur; a myopic shift after 60 can signal cataract) or A\* > +3.00 (beyond ready-made readers, Stevens 2019). "No readers yet" if A\* < +0.75. These are bench rules from the brief.
- **within ±0.25 / ±0.50, exact**: over *all* in-scope people. Being told "no readers" or "refer" counts as a miss.
- **bias, mean |error|**: over in-scope people who were given a pair (+ = too strong).
- **Referral sensitivity**: share of people who should be referred who were *not* handed readers.
- **Right call, everyone**: over all virtual people. Counts as right if they got a pair within ±0.50 D of ideal when they need one, or no readers when they should be referred or don't need readers yet. This is the fairest single number, because the in-scope columns don't penalise a method for never referring anyone.

## Headline results (main scenario, seed 20261003, n = 20,000)

10,763 in scope · 3,233 don't need readers yet · 2,036 myopic (refer) · 3,968 need more than +3.00 (refer).

| Method | Right call, everyone | In scope ±0.25 | In scope ±0.50 | Bias (D) | Mean abs. error (D) | Referral sensitivity | Myopes handed readers | Handed readers, don't need them yet |
|---|---|---|---|---|---|---|---|---|
| Age table (40 cm) | 42.0% | 49.4% | 75.1% | +0.07 | 0.45 | 0.0% | 100% | 100% |
| Age table + measured distance | 43.1% | 42.2% | 63.2% | +0.28 | 0.51 | 22.3% | 88.7% | 87.1% |
| Rack card at 14 in | 50.9% | 47.2% | 63.9% | −0.38 | 0.51 | 42.4% | 99.9% | 100% |
| Rack card where they read | 52.1% | 46.7% | 64.3% | −0.43 | 0.51 | 45.8% | 99.9% | 100% |
| **Small Print start** | 69.6% | 58.6% | 79.8% | +0.04 | 0.33 | 41.0% | 32.9% | 17.9% |
| **Small Print + try-on (0.50 stock)** | **84.6%** | **71.6%** | **84.4%** | −0.10 | 0.25 | **79.9%** | 11.1% | 16.5% |
| **Small Print + try-on (0.25 stock)** | 85.4% | 73.9% | 86.4% | −0.03 | 0.24 | 80.4% | 10.9% | 16.7% |
| *What-if: try-on + probe pair (0.50), not shipped* | 84.8% | 72.7% | 84.8% | −0.11 | 0.25 | 80.0% | 11.1% | 16.5% |
| *What-if: try-on + probe pair (0.25), not shipped* | 86.0% | 76.5% | 87.0% | −0.04 | 0.22 | 80.6% | 10.9% | 16.5% |
| *Reference: true ideal snapped to 0.50 stock* | 100% | 100% | 100% | +0.12 | 0.12 | 100% | 0% | 0% |

Mean pairs tried at the rack: 1.30 (0.50 stock). Full tables, including breakdowns by age and by refractive error: `public/data/bench-summary.md`.

### What the bench says, honestly

1. **Measuring helps, mostly through the try-on and through referral.**
   - Small Print's no-glasses start beats the age table on in-scope accuracy (58.6% vs 49.4% within ±0.25), but only modestly at ±0.50 (79.8% vs 75.1%).
   - The try-on adds about 13 points at ±0.25.
   - The big difference is people who shouldn't get readers. The age table and rack card hand readers to essentially every myope and every person who doesn't need them yet.
2. **The age table is not beaten everywhere.**
   - For in-scope people aged 60–70, the plain 40 cm table is within ±0.50 for 92–95%, versus 83–84% for Small Print's start and 91% after try-on. In this model everyone over about 62 has no accommodation left, so +2.50 is right for most of them.
   - At 40–44 the table's +1.00 is within ±0.50 for 73.5% of in-scope people, versus about 45% for Small Print. Small Print tells many borderline people (ideal +0.75/+1.00) that they don't need readers yet.
   - Over everyone (right call), Small Print + try-on wins in every age band (81–87% vs 31–49% for the table), because the table gives readers to all who don't need them. The start alone loses to the rack card at 60+ (60–61% vs 67–73%).
3. **Uncorrected long sight is the weak spot for every method.**
   - For in-scope people with RE +0.76 to +2.00 D, try-on reaches only 34.9% within ±0.25 (bias −0.47 D). That is *worse than the plain age table* (49.6%).
   - Above +2.00 D almost nobody is within ±0.50 under any method.
   - Cause: a near-only test can't separate long sight from accommodation (the RE/2 term above). With readers on, these people's far limit is beyond arm's reach, or beyond infinity.
4. **The try-on's far-end blind spot.** In 52.6% of try-on measurements the far limit was beyond arm's reach. In that branch `assessTryOn()` can only answer "good" or "stronger". With perfect measurements the try-on reaches only 77.9% within ±0.25. When the far end is always measurable and nobody has refractive error, it reaches 99.3%: the model and the algorithm agree exactly, so the gap is the blind spot, not a modelling mismatch.
5. **Distance error that is shared across readings barely matters; per-reading error and blur judgement do.**
   - A shared calibration error is a common scale on every distance and largely cancels in the try-on midpoint: 72.3% → 69.1% within ±0.25 from 0% to 8%.
   - Independent per-reading error does not cancel: 72.5% → 59.6% at 8%.
   - Blur-judgement error matters most: 76.2% → 71.6% → 61.7% at 0 / 0.25 / 0.50 D.
6. **Depth-of-focus assumption: not sensitive.** True DOF from 0.3 to 1.0 D, against the assumed 0.50 D, moves the start by about 2.5 points and the try-on by about 4. There is no case for changing `DEPTH_OF_FOCUS_D`.
7. **Near-point weight: already near the optimum.**
   - `NEAR_POINT_WEIGHT` 0.6 scores 58.6% / 79.8% (±0.25 / ±0.50).
   - 0.8 scores 58.9% / 77.8%; 0.4 scores 52.6% / 76.0%.
   - The same holds in the lower-amplitude population (0.6 → 59.5% / 80.3%).
   - No change proposed. Any future change tuned on this bench must be disclosed as tuned to our own simulated truth.
8. **Biggest real-world risk: how the working distance is captured.**
   - If people hold the phone halfway out toward their no-glasses near point when asked "where do you read?", try-on accuracy collapses to 37.1% / 57.6% (±0.25 / ±0.50, bias −0.47). This is because the try-on centres the *measured* W.
   - A 5% random difference between the captured and the real reading distance costs about 5 points.

## Assumptions (complete list)

Every assumption is also in `bench.json` → `assumptions`.

1. Age uniform 40–70. **Assumption.**
2. Accommodation ~ Hofstetter (1950) mean, SD 0.75 D, clipped to [0, Hofstetter max]. **Source + assumption (SD).** Norms partly include depth of focus (see caveat).
3. Refractive error mixture as tabulated. **Assumption**, informed by Kempen 2004.
4. Depth of focus uniform 0.3–1.0 D. **Wang & Ciuffreda 2006.**
5. Working distance N(37, 5) cm. **Bababekova 2011 + assumption (SD).**
6. Reach 55–70 cm; minimum measurable distance 12 cm. **Assumption.**
7. Thin-lens optics at the eye; vertex distance, astigmatism, anisometropia, eye disease and reduced acuity are ignored. The constant-angle E removes size cues. **Assumption / standard optics.**
8. Ideal = W in the middle of the clear range. **Stevens 2019.**
9. Scope rules (refer if RE < −1.00 or ideal > +3.00; none if ideal < +0.75). **Bench rule.**
10. Camera distance error: shared SD 4% + per-reading SD 1%. **MediaPipe Iris 2020 + assumption (split).**
11. Blur-judgement error SD 0.25 D per limit, independent. **Assumption.**
12. Rack protocol (weaker pair first, follow the suggested change, max 3 pairs). **Assumption.**
13. Rack card = ideal blur meter + reserve calibrated in the card's favour; myopic blur read as plus; letter-size change ignored. **Assumption, generous to the card.**
14. No learning, fatigue or lighting effects; people follow instructions. **Assumption.**

## Suspected issues in `src/core` (reported, not changed)

1. **`assessTryOn()` far-end-beyond-reach branch** (`tryon.ts`, `if (dFar === null)`).
   - The problem: it returns "good" unless the pair is too weak even in the best case, so it never returns "weaker" there.
   - Evidence: perfect-measurement try-on at 77.9% within ±0.25; 52.6% of measurements hit this branch; most residual errors are "good" verdicts with no far limit.
   - What-if, using the shipped function unchanged: when "good" comes from this branch, try a pair 0.50 D stronger. That pulls the far end in, and readers shift the clear range rigidly, so one fully measured pair fixes the answer for every pair. Result: +1.1 points (0.50 stock) and +2.6 points (0.25 stock) within ±0.25 with noise, for about 0.6 extra pairs.
   - A tempting alternative fails: estimating the far end as strength − DOF/2 *lowers* accuracy to 69.5%, because it assumes no refractive error.
   - Suggested change: have `assessTryOn` mark this case, for example `farEndUnknown: true`, so the UI asks for one stronger pair before confirming.
2. **Long sight is invisible to near-only tests** (`recommend()` and try-on alike). Untested idea, not simulated: a distance blur check through the candidate pair ("is a sign across the room blurry with these on?"). This is the plus-lens idea used in school vision screening. An emmetrope sees distance blurred through +1.00 or more; a hyperope does not.
3. **`possible-myopia` threshold** (Hofstetter max + 1.5 D) catches few myopes at the start: 32.9% of them get readers, and only 6.6% of missed referrals carry any flag.
   - Lowering the margin to 1.0 D: myopes handed readers after try-on fall 11.1% → 8.1%, wrongly referred in-scope people rise 3.6% → 3.9%.
   - Lowering it to 0.5 D: 6.7% and 5.0%.
   - Overall right call is unchanged (84.6% → 84.7% / 84.1%). It is a trade-off, not a clear win.

## Limitations

- Simulation only. Real errors include things not modelled here: lighting, letter recognition, anisometropia, cataract, pupil and DOF changing with age, people not following instructions.
- The comparison with the age table depends on the accommodation norm. In the lower-amplitude population the age table's in-scope accuracy is similar (49.8% / 76.0%), while Small Print's start and try-on barely change (59.5% / 80.3% and 70.2% / 84.0%).
- The rack-card model is an idealisation. Real cards vary.
- The "ideal" (half the accommodation in reserve) is a clinical rule of thumb. Real comfort varies.

## Files

- `model.ts`: seeded PRNG, virtual-person generator, optics, simulated measurements.
- `strategies.ts`: baselines, mapping of Small Print's shipped functions, rack protocol, what-if variants.
- `engine.ts`: runs a scenario; metrics; histograms.
- `suite.ts`: main run, sensitivity sweeps, what-ifs, assumptions list. No file I/O.
- `charts.ts`: dependency-free SVG charts (with `<title>`/`<desc>`, a white card background for dark pages).
- `bench.ts`: CLI entry; writes `public/data/*` and `public/figures/bench-*.svg`.
- `../tests/sim.test.ts`: determinism, optics identity, replica check, and the consistency sanity check. The realistic-reach sanity check is kept as a documented `it.fails` (known issue 1).
