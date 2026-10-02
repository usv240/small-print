# Clinical check: Small Print on real people from published studies

> **Real people, published data.** Every row comes from an open clinical dataset that another research group published. These are not our users, not people we recruited, and not a simulation.
> **What this tests:** the recommendation algorithm (`recommend()`, imported unmodified) fed with near points that clinics measured (push-up rule, defocus curves). It does **not** test the phone camera. The app's own distance error comes on top of these results.

Reproduce (about 5 s; the first run downloads three CC BY 4.0 spreadsheets, ~200 KB, to `%TEMP%/clinical`; set `CLINICAL_DIR` to override):

```
cd web
npx tsx sim/clinical.ts
```

Outputs: `public/data/clinical.json` (sources with SHA-256 of each input file, method, assumptions, all results, one row per person) and `public/figures/clinical-accuracy.svg`.

## Headline

On **296 presbyopes in scope for ready-made readers**, drawn from two published clinical datasets (south India n = 283, Madrid n = 13):

| | Small Print start | Age table (named baseline) |
|---|---|---|
| Within ±0.50 D of the clinician's near prescription | **86.5 %** (95 % CI 82.1–89.9) | 84.1 % (79.5–87.8) |
| Within ±0.25 D | 62.8 % | 58.8 % |
| Exact (±0.125 D) | 27.4 % | 30.1 % |
| Bias / mean absolute error (people offered readers) | −0.21 D / 0.32 D | −0.22 D / 0.35 D |

- Paired comparison at ±0.50 D: the app alone was right for 19 people and the table alone for 12. McNemar exact p = 0.28, so **no statistically significant difference**.
- **Short-sighted people** (distance SE below −1.00 D, n = 23): the age table offered readers to all 23. Small Print withheld them from 12 (Madrid 10 of 12, India 2 of 11).
- **Long-sighted people whose near prescription exceeds +3.00** (n = 42): both methods offered readers to all 42, and none was within ±0.50 D. The no-glasses test cannot see hyperopia well, so it relies on the try-on step, which this data cannot test.

**The one sentence we can claim:**
"On 296 presbyopes from two published clinical datasets we did not collect, Small Print's starting strength was within ±0.50 D of the clinician's near prescription for 86.5 % (95 % CI 82–90 %). That is statistically indistinguishable from the age table's 84.1 %, but unlike the age table it withheld readers from 12 of 23 short-sighted people."

Do **not** claim that the app beats the age table on accuracy, or that the camera was validated.

## Data: what we searched and what we used

Search date: 2 Oct 2026. Sources searched:
- the DataCite API, which covers Zenodo, figshare, Dryad, Mendeley Data, OSF, Harvard Dataverse and the UK Data Service (16 queries: amplitude/near point of accommodation, push-up, presbyopia, near/reading addition, reading glasses);
- the Zenodo, figshare, Dataverse and Dryad APIs;
- Europe PMC open-access papers with supplementary data (5 queries), with the full text and supplement list checked for 20 papers;
- PLOS ONE supplements;
- the NHANES documentation.

Not searched: Kaggle and PhysioNet.

| Dataset | Licence | n | Has near point? | Has clinical add? | Used as |
|---|---|---|---|---|---|
| **Khurana et al., Sci Rep 2023;13:22906**, south India clinic ([doi](https://doi.org/10.1038/s41598-023-50288-w), Supplementary xlsx) | CC BY 4.0 | 342 (ages 38–80) | push-up NPA (RAF rule, cm) and AA, right eye | near add, right eye | **Primary** |
| **García-del-Castillo et al., J Pers Med 2026;16(9):465**, Madrid ([data](https://doi.org/10.5281/zenodo.22013721)) | CC BY 4.0 | 30 (45–64) | binocular defocus curve −3.50…+1.50 D (gives the raw near limit) | subjective add, fused cross-cylinder at 40 cm; full refraction per eye | **Primary** |
| Baoud-Ould-Haddi et al., Zenodo 2026, Madrid phakic 45–65 ([data](https://doi.org/10.5281/zenodo.19482311)) | CC BY 4.0 | 77 | amplitude (values are 100/cm) | none | Secondary (rule-derived reference) |
| CHRISTMAS study, Harvard Dataverse ([doi](https://doi.org/10.7910/DVN/XQWEIT)) | CC0 | 70 | no | add, sphere, cylinder, reading distance | Not used: with no near point the app *is* the age table |
| Ayaki/Negishi group, PLOS ONE 2025/2021/2019 S1 data (pone.0334117, .0259142, .0250087, .0211631) | CC BY 4.0 | up to ~1,147 | no | minimum add for 20/25 at 30 cm | Not used: no near point; threshold add; dry-eye/glaucoma clinics |
| PLOS ONE 2019 diurnal amplitude (pone.0225754) | CC BY 4.0 | 154 | push-up | no | Not used: age only in decades, no add |
| PLOS ONE 2020 autorefractor amplitude (pone.0224733) | CC BY 4.0 | 35 | objective only | no | Not used |
| Rwanda eye-care survey (Dryad 10.5061/dryad.p6qb650) | CC0 | – | no (per abstract) | – | Not used |
| WE-ACE Zanzibar (Zenodo 10.5281/zenodo.13749309) | CC BY 4.0 | 209 | no | no; age in groups only | Not used |
| NHANES 2005–06 vision exam (VIX_D) | public | – | no (near card, refraction, VA only) | no | Not used |
| Red-light presbyopia trial (Ann Med 2026), BMC Ophthalmol 2022/2025, Eye 2024 nine-country, Front Ophthalmol 2026 digital tool | various | – | some | some | Not used: no per-person rows, data on request, or controlled access |
| Duane 1922 / Hofstetter 1950 tables | – | grouped | – | – | Not used: grouped, and circular (the app uses Hofstetter) |

## Method

For each real person, we work out what the app would have measured, run `recommend()` on it, and compare the result with the clinician's prescription.

1. **Uncorrected clear range.** This is the nearest and farthest clear point without glasses, as vergence in D.
   - **India:** near = AA − SE. AA is the push-up near point in dioptres, assumed to have been taken through the distance Rx. SE is the right-eye far refraction. Far = −SE − 0.25.
   - **Madrid:** we take the binocular defocus curve, which was measured through the full distance correction, and find where acuity crosses the app's letter size, logMAR 0.27 (N6 at 40 cm, computed from `optics.ts`). We use linear interpolation between lens steps. A lens d on the corrected eye is equivalent to the uncorrected eye viewing vergence −(d + SE), so near = −d_near − SE and far = −d_far − SE. SE is the mean of both eyes.
   - **Phakic:** near = AA − SE, far = −SE − 0.25.
2. **App measurements.** These follow the same rules as `sim/model.ts`:
   - working distance 40 cm;
   - arm reach 62.5 cm;
   - "near point beyond reach" when the near limit is farther than reach or there is no clear range;
   - near point clamped at the 12 cm camera minimum;
   - no added noise, because published measurements already carry clinical error.

   **Small-print answer:**
   - In India it is measured for the 258 people without previous near glasses (presenting near VA ≤ N6).
   - Everywhere else it is derived (true if 40 cm lies inside the uncorrected clear range).
3. **Methods compared:**
   - `recommend()` from `src/core/recommend.ts`, imported and not copied;
   - the named baseline, `ageTableAdd40()` + `addForWorkingDistance()`, rounded to 0.25 D, with < +1.00 meaning "no readers" and > +3.00 meaning "refer" (same rule as `ageTableAtDistance` in `sim/strategies.ts`);
   - a diagnostic only: the app's internal near-point estimate before blending (`detail.fromNearPoint`).
4. **Reference.**
   - Clinical datasets: the clinician's near prescription for the uncorrected eye = distance SE + near add. This is what a ready-made pair has to supply.
   - Phakic: rule-derived, SE + 1/WD − AA/2. This shares the app's own rule, so it is partly circular.
5. **Scope.** We use the same `SCOPE` rules as the simulated bench (`sim/model.ts`):
   - refer if distance SE < −1.00 D or the reference is above +3.00;
   - "not yet" if the reference is below +0.75;
   - otherwise in scope.

   Accuracy is scored over **all in-scope people**: being told "no readers" or "refer" counts as a miss. 95 % CIs are Wilson intervals, and the paired test is exact McNemar.

## Assumptions (all of them)

1. Working distance is 40 cm for everyone, because no dataset records habitual reading distance. Sensitivity analyses use 33 and 45 cm, with the reference add shifted by the dioptric difference (Stevens rule).
2. India: the add was prescribed for 40 cm, since the test distance is not reported. A sensitivity analysis uses 33 cm.
3. India: AA is the push-up near point. In 276 of 342 rows AA = 100/NPA. In 66 rows the NPA sits at 47–50 cm while AA is below 2 D, which looks like the end of the 50 cm RAF rule. Sensitivity analyses use the NPA column instead, or drop those rows.
4. India: the NPA was measured through the distance refraction. This does not matter for the 221 people with zero far refraction. A sensitivity analysis drops the assumption.
5. India: right eye only, as in the study. The app tests both eyes together.
6. Madrid: "clear" means acuity at least as good as the app's letter (logMAR 0.27). Sensitivity analyses use 0.20 and 0.10. Blank subjective sphere cells are read as plano (two people). Astigmatism is ignored by the app; the 9 people with more than 1.00 D cylinder or anisometropia are also reported separately.
7. Phakic: amplitude was measured through the distance correction (not stated).
8. Without a defocus curve, the far limit of clear vision is −SE − 0.25 D (half the app's 0.5 D depth of focus).
9. Arm reach is 62.5 cm, the middle of the bench's 55–70 cm. Sensitivity analyses use 55 and 70 cm. The camera minimum is 12 cm.

## Results

Primary analysis: 40 cm, reach 62.5 cm, app letter size. The first figure in each pair is the app, the second is the age table. Shares are of all in-scope people.

| Dataset | n | In scope | Exact % | ±0.25 D % | ±0.50 D % (95 % CI) | Bias D | MAE D | McNemar p |
|---|---|---|---|---|---|---|---|---|
| India (all) | 342 | 283 | 27.2 / 30.4 | 63.6 / 60.1 | **86.2** (81.7–89.8) / 84.8 (80.2–88.5) | −0.22 / −0.23 | 0.32 / 0.35 | 0.56 |
| India, zero far refraction | 221 | 219 | 32.4 / 36.1 | 70.3 / 69.9 | 92.2 (87.9–95.1) / **95.4** (91.8–97.5) | −0.17 / −0.19 | 0.26 / 0.25 | 0.09 |
| Madrid (all) | 30 | 13 | 30.8 / 23.1 | 46.2 / 30.8 | **92.3** (66.7–98.6) / 69.2 (42.4–87.3) | −0.16 / −0.01 | 0.28 / 0.42 | 0.38 |
| Madrid, readers-suitable (cyl and aniso ≤ 1.00) | 21 | 12 | 25.0 / 25.0 | 41.7 / 33.3 | 91.7 / 75.0 | −0.17 / −0.07 | 0.31 / 0.39 | 0.63 |
| **Both clinical datasets** | 372 | **296** | 27.4 / 30.1 | 62.8 / 58.8 | **86.5** (82.1–89.9) / 84.1 (79.5–87.8) | −0.21 / −0.22 | 0.32 / 0.35 | 0.28 |
| Phakic (rule-derived, secondary) | 77 | 40 | 25.0 / 17.5 | 42.5 / 32.5 | 80.0 (65.2–89.5) / 60.0 (44.6–73.7) | +0.17 / +0.41 | 0.30 / 0.52 | 0.008 |

**By age band** (both clinical datasets, ±0.50 D, app / table):

| Band | n | App / table % | Bias D app / table |
|---|---|---|---|
| 38–44 | 98 | 92.9 / 90.8 | −0.08 / −0.21 |
| 45–49 | 87 | 87.4 / 80.5 | −0.27 / −0.30 |
| 50–54 | 65 | 80.0 / 84.6 | −0.39 / −0.32 |
| 55–59 | 30 | 76.7 / 70.0 | −0.22 / +0.03 |
| 60+ | 16 | 87.5 / 87.5 | 0.00 / +0.06 |

**People who should not get readers** (both clinical datasets; phakic in brackets):

| Group | n | App: readers / no readers / refer | Age table: readers |
|---|---|---|---|
| Distance SE below −1.00 D (myopia) | 23 [24] | 11 / 12 / 0 [12 / 12 / 0] | 23 [24] |
| Near Rx above +3.00 (beyond stock) | 42 [11] | 42 / 0 / 0, none within ±0.50 [11 / 0 / 0] | 42 [11] |
| Near Rx below +0.75 (not yet) | 11 [2] | 10 / 1 / 0 (4 within ±0.50) [1 / 1 / 0] | 11 [2] |

The 9 India myopes given readers were offered +1.00 (6 people), +1.50 (2) or +1.75 (1), and 6 of the 9 were flagged `inconsistent`.

`possible-myopia` cannot fire below about age 46. Its threshold (Hofstetter max + 1.5 D) corresponds to a near point closer than the 12 cm camera minimum assumed by the bench.

**Sensitivity** (in scope, ±0.50 D, app / table):

| Scenario | India | Madrid | Both |
|---|---|---|---|
| Primary | 86.2 / 84.8 | 92.3 / 69.2 | 86.5 / 84.1 |
| Working distance 33 cm | 87.5 / 86.3 | 91.7 / 66.7 | 87.6 / 85.5 |
| Working distance 45 cm | 78.8 / 44.5 | 84.6 / 53.8 | 79.1 / 44.9 |
| Reach 55 cm | 85.5 / 84.8 | 100 / 69.2 | 86.1 / 84.1 |
| Reach 70 cm | 86.2 / 84.8 | 92.3 / 69.2 | 86.5 / 84.1 |
| Madrid "clear" = logMAR 0.20 | – | 100 / 69.2 | 86.8 / 84.1 |
| Madrid "clear" = logMAR 0.10 | – | 84.6 / 69.2 | 86.1 / 84.1 |
| India near point from NPA column | 83.4 / 84.8 | – | 83.8 / 84.1 |
| India, drop 66 AA≠100/NPA rows (n = 236) | 89.0 / 88.6 | – | 89.2 / 87.6 |
| India NPA measured without distance Rx | 82.3 / 84.8 | – | 82.8 / 84.1 |
| India add prescribed for 33 cm | 86.6 / 85.5 | – | 86.8 / 84.7 |
| Small-print answer derived for everyone | 72.1 / 84.8 | 92.3 / 69.2 | 73.0 / 84.1 |
| Small-print check skipped (null) | 72.1 / 84.8 | 92.3 / 69.2 | 73.0 / 84.1 |

The 45 cm drop for the age table is a property of that baseline: it says +0.75 for ages up to 45, which is below stock, so it counts as "no readers".

**Checks on the mapping and the reference:**

- **India small print.** Measured presenting near VA says only 4 of 258 people without near glasses could read N6. Their push-up near points imply 133 could (agreement 48 %). The push-up near point (fixed-size target that grows as it approaches, right eye) therefore overstates usable near vision here. The India result **depends on the real "can't read small print" answer**: without it (derived or skipped), the app falls to 72 %, below the table.
- **India near-point arm (diagnostic).** On its own, the app's internal near-point estimate is too weak: 76.2 % within ±0.50, bias −0.34 D (n = 210 with a measured near point). Madrid shows the same: 77.8 %, −0.29 D (n = 9). The age-table blend and the "+1.00 when small print fails" rule pull it back.
- **India reference is strongly age-linked.** Among zero-refraction people the add correlates with age at r = 0.80 (0.83 with the Stevens table, identical in 36 %). Amplitude still explains some of what age does not (partial r = −0.30). An age table is therefore a strong baseline on this dataset.
- **Madrid mapping.** The defocus curve predicts uncorrected binocular near VA at 40 cm with mean error −0.03 logMAR (MAE 0.21, n = 8 people with a measured value). It gives the same N6 verdict for 75 % of them.

## Limitations

- **Not the app's measurement.** Near points come from a push-up rule (India) or 4 m defocus curves (Madrid), not from a constant-angle E on a phone with camera ranging. Camera distance error, lighting and instructions are not included.
- **The reference is not ground truth.** The clinician's add varies by about ±0.25–0.50 D between examiners and methods. In India it tracks age closely, which favours the age table.
- **Small, unequal samples.**
  - Madrid has only 13 people in scope. Its 92 % vs 69 % is not significant.
  - India dominates the pooled numbers, and only 16 people are aged 60+.
- **India: details not reported in the paper.**
  - Right eye only.
  - The add test distance is unknown.
  - It is unknown whether NPA was taken through the distance Rx.
  - The near-point column looks ceiling-limited at the 50 cm ruler end.
- **Things the app (and readers) cannot handle are ignored:** astigmatism, anisometropia, and eye disease (the studies excluded disease).
- **Missing measurements:**
  - No study recorded habitual reading distance.
  - No study measured the clear range through test lenses, so the try-on step (`tryon.ts`), which should catch the 42 people above +3.00, is **not evaluated**.
- **Phakic results are partly circular** (rule-derived reference). Its near-point-only estimate is 100 % within ±0.50 by construction, which is a sanity check of the mapping, not evidence.
- **Multiple comparisons.** The sensitivity analyses are exploratory and their p-values are not adjusted. The primary settings (40 cm, app letter size, 62.5 cm reach, bench `SCOPE` rules) were chosen before any results were seen. One later change only affects a sensitivity row: 33 cm is now coded as 1000/3 mm, so that a 0.003 D rounding drift no longer flips errors that sit exactly at −0.50 D.

## Licences and privacy

All three datasets used are CC BY 4.0; attribution is in this file, in `clinical.json` and in the figure. The per-person rows in `clinical.json` keep only study IDs, age, refraction, add and derived values. The India hospital record number ("MRD no.") is deliberately **not** copied.
