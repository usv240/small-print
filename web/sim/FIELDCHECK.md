# Field check: our simulation vs published real-world reading-glasses data

> **What this is.** A population-level plausibility check. We compare (a) the virtual people in the simulated test
> bench and (b) Small Print's *simulated* recommendations with reading-glasses powers that real community
> programmes published, by age. **We recruited nobody.** Every field number below is copied or digitised from an
> open-access paper. This check cannot tell whether Small Print picks the right pair for any individual; only a
> field study can.

Run: `npx tsx sim/fieldcheck.ts` (about 5 s). Outputs: `public/data/fieldcheck.json` (every number below, plus
sources and definitions), `public/figures/fieldcheck-power-by-age.svg`, `public/figures/fieldcheck-sensitivity.svg`.
Same seed (20261003) and the same 20,000 virtual people as `sim/bench.ts`. No sim or `src/` file was changed.
Shipped functions are imported unchanged. The script checks its strategy loop against `runScenario()` and its
generator wrapper against `makePerson()`; it stops if either differs.

## Sources

| # | Source | What we extracted (and where) | Used for |
|---|---|---|---|
| 1 | Katibeh M, Watts E, Gichangi M, Latorre-Arteaga S, Bolster NM, Bastawrous A. *Near vision data and near correction requirements from community eye health programmes in nine countries.* Eye (Lond) 2024;38:2150–2155. doi:10.1038/s41433-023-02910-4 (PMC11269744, CC BY) | **Table 4**: mean power of ready readers identified at triage, by 5-year age band, for Kenyan non-owners of glasses (n = 31,474). Exact values. **Fig. 1d**: box plot by age. Quartiles and whisker caps were read from pixel rows; they sit exactly on the 0.25 D grid. Medians that coincide with a box edge are taken from the authors' text: "1.50 D for people aged 40–44 years, 2.00 D for 45–54 years, 2.50 D for 55–59 years and 3.00 D for over 60". **Fig. 1c**: count at each power, all ages. Digitised from bar heights, ±~25 people per bar; our total is 34,022 against 34,283 reported. **Table 2**: % failing near screening by age (n = 388,939). | Main comparison |
| 2 | Katibeh M, Sabherwal S, Javed M, *et al.* *A novel digital tool to guide provision of near vision glasses for presbyopia correction in the community.* Front Ophthalmol 2026;6:1891054. doi:10.3389/fopht.2026.1891054 (PMC13500277, CC BY) | **Table 2**: optometrist-prescribed power, mean and median by age band. India, n = 378, distance VA ≥ 6/12 in both eyes and near VA worse than N6 at 40 cm, mean age 45.7. Per-band n is not given in the text. The 40–44 upper CI is printed as "2.26" (likely 1.26) and is not used. | Second comparison |
| 3 | Smret TM, Weldegergis RK, Achila OO, Tekle AM. *Understanding Presbyopia in Asmara: Prevalence, Association with Refractive Error, and Age-Based Addition.* Clin Optom 2023. doi:10.2147/OPTO.S421366 (PMC10516207) | **Table 4** ("All" rows): near **add** over full distance correction, mean ± SD by age band. Everyone aged 35–60 attending eye centres, n = 1,310; add = "minimum plus" that reads 0.00 logMAR at 40 cm. **Table 2**: % presbyopic by age. The 41–45 row's non-presbyopic count is misprinted; we use the 77.6% presbyopic share. | Everyone, not only people who failed a screen: onset check and calibration anchor |
| 4 | Sehrin F, *et al.* *THRIVE randomized controlled trial.* PLoS One 2024;19:e0296115 (PMC10990163) | Table 1: median power +1.00 (IQR +1.00 to +1.50), mean age about 47. | **Context only.** These powers were *assigned* from unaided near acuity by a fixed rule, not measured. |
| 5 | Panke K, *et al.* Proc SPIE 11207, 112070Y (2019). doi:10.1117/12.2527291 | Abstract only (full text paywalled): 216 adults aged 35–80, age vs add r = 0.73, large individual spread. | **Context only.** No per-age values. |

**Not obtained:**

- Fig. 2 of source 2 (power distribution by age), because the image was not retrievable.
- The supplementary files of source 1.
- Any VisionSpring or BRAC power-by-age table.

## Method

1. **Population check.** In the main bench population, we take the people a programme would hand readers: not
   short-sighted beyond −1.00 D (a proxy for the "distance VA 6/12" entry rule) and ideal of at least +1.00.
   - We compute their ideal power at the field charts' 40 cm, A\* = 2.5 + RE − AA/2, capped to the field stock range +1.00..+4.00.
   - We compare it by 5-year band with Kenya (source 1) and India (source 2).
   - For everyone, with distance error corrected, we compare the sim's add (2.5 − AA/2) and its share of presbyopes with Asmara (source 3).
   - We compare the sim's unaided N6-at-40 cm failure rate with Kenya's screening failure rate.
2. **Recommendation check.**
   - We take the strengths handed out by the shipped strategies on the same virtual people: Small Print start, Small Print + try-on, and the Stevens age table.
   - We compare them by band (mean and median) with the field powers.
   - We also compare the overall distribution with Kenya Fig. 1c. To do this, the sim is re-weighted to Kenya's age mix (Table 4 counts). In our model everyone past 62.5 has zero accommodation, so Kenya's 70+ counts use the sim's 65–70 band.
   - Statistics: Kolmogorov–Smirnov distance and overlap (Σ min share) on 0.50 D steps.
3. **Sensitivity.** Post-hoc reweighting cannot fix the young bands. Only 154 of 3,431 virtual 40–44-year-olds fail N6 at 40 cm. 108 of them are strong myopes, for whom 40 cm is too far. The other 46 are high hyperopes (mean +3.0 D). Nobody in the band has field-like low accommodation, so there is no one suitable to up-weight. Instead:
   - We **wrap the generator**. `makePerson()` is called unchanged, then accommodation is re-drawn with the *same* random deviate around a lower age curve. Age, refraction, depth of focus, distance and reach stay identical (common random numbers).
   - The curve is solved so that the sim's mean add matches Asmara's at each band midpoint, under two readings of "add":
     - **half reserve**: add = 2.5 − AA/2, the bench's own definition of ideal;
     - **minimum plus**: add = 2.5 − AA − DOF/2, Asmara's literal definition.
   - Separately, **post-hoc reweighting** of the upper tail: people needing more than +3.00 are down-weighted to Kenya's share.

## Results

### (a) Population: power needed by people handed readers (mean / median, D)

| Age | Kenya mean / median [IQR] | India mean / median | Sim ideal at 40 cm, mean / median [IQR] | Sim − Kenya (mean) | Sim − India (mean) | Sim share needing readers |
|---|---|---|---|---|---|---|
| 40–44 | 1.50 / 1.50 [1.00–2.00] | 1.21 / 1.00 | 1.45 / 1.00 [1.00–1.75] | −0.05 | +0.24 | 23.5% |
| 45–49 | 1.83 / 2.00 [1.50–2.00] | 1.57 / 1.50 | 1.47 / 1.25 [1.00–1.75] | −0.36 | −0.10 | 49.5% |
| 50–54 | 2.19 / 2.00 [2.00–2.50] | 2.05 / 2.00 | 1.83 / 1.75 [1.25–2.25] | −0.36 | −0.22 | 77.5% |
| 55–59 | 2.51 / 2.50 [2.50–2.75] | 2.24 / 2.00 | 2.35 / 2.25 [1.75–2.75] | −0.16 | +0.11 | 88.3% |
| 60–64 | 2.81 / 3.00 [2.50–3.00] | 2.58 / 2.50 | 2.83 / 2.75 [2.50–3.25] | +0.02 | +0.25 | 90.2% |
| 65–69 | 2.90 / 3.00 [2.75–3.00] | 2.78 / 3.00 (≥65) | 2.87 / 2.75 [2.50–3.25] | −0.03 | +0.09 | 90.4% |

Mean |sim − field| over the six bands: **0.16 D vs Kenya, 0.17 D vs India**. The sim lies between the two field sources
in 3 of 6 bands (40–44, 55–59, 65–69). The largest gap is at 45–54: the sim is 0.36 D weaker than Kenya there.

### (a) Population: everyone, and when people start to need readers

| Age | Asmara add (distance corrected) | Sim add, half reserve | Asmara % presbyopic | Sim % presbyopic | Kenya % failing near screen | Sim % failing N6 at 40 cm (no glasses) |
|---|---|---|---|---|---|---|
| 41–45 / 40–44 | +1.30 | +0.08 | 77.6% | 0.0% | 27.7% | 4.5% |
| 46–50 / 45–49 | +1.77 | +0.55 | 98.2% | 2.2% | 34.4% | 10.8% |
| 51–55 / 50–54 | +2.15 | +1.30 | 100% | 40.0% | 39.6% | 44.8% |
| 56–60 / 55–59 | +2.37 | +2.04 | 98.3% | 95.3% | 38.9% | 87.5% |

Kenya's screening rates use presenting vision: glasses wearers could pass, and the tests were informal. They are
a floor at 40–49 and not comparable at older ages.

### (b) Recommendations vs field (mean / median among people handed readers, D)

| Age | Kenya | India | Small Print start | Small Print + try-on (0.50) | Age table (40 cm) | Try-on − Kenya | Try-on − India |
|---|---|---|---|---|---|---|---|
| 40–44 | 1.50 / 1.50 | 1.21 / 1.00 | 1.25 / 1.25 | 1.19 / 1.00 | 1.00 | −0.31 | −0.02 |
| 45–49 | 1.83 / 2.00 | 1.57 / 1.50 | 1.41 / 1.25 | 1.31 / 1.00 | 1.50 | −0.52 | −0.26 |
| 50–54 | 2.19 / 2.00 | 2.05 / 2.00 | 1.82 / 1.75 | 1.69 / 1.50 | 2.00 | −0.50 | −0.36 |
| 55–59 | 2.51 / 2.50 | 2.24 / 2.00 | 2.42 / 2.50 | 2.19 / 2.00 | 2.50 | −0.32 | −0.05 |
| 60–64 | 2.81 / 3.00 | 2.58 / 2.50 | 2.62 / 2.50 | 2.51 / 2.50 | 2.50 | −0.30 | −0.07 |
| 65–69 | 2.90 / 3.00 | 2.78 / 3.00 | 2.62 / 2.50 | 2.55 / 2.50 | 2.50 | −0.35 | −0.23 |

Mean difference from Kenya:

| Method | Mean difference | Range across bands |
|---|---|---|
| Small Print + try-on | −0.38 D | median −0.50 D lower in every band |
| Small Print start | −0.27 D | −0.09 to −0.42 D |
| Age table | −0.29 D | −0.01 to −0.50 D |

The Kenyan authors' own starting rule (1.50 / 2.00 / 2.00 / 2.50 / 3.00) is 0.50 D above Stevens' table at 40–49
and at 60+. Against India, try-on is −0.17 D on average and the start is −0.05 D.

**Overall distribution vs Kenya Fig. 1c** (0.50 D steps +1.00…+4.00, % of people given readers):

| Distribution | +1.00 | +1.50 | +2.00 | +2.50 | +3.00 | +3.50 | +4.00 |
|---|---|---|---|---|---|---|---|
| Field | 5.3 | 12.4 | 27.9 | 23.8 | 24.7 | 4.8 | 1.1 |
| Sim ideal at 40 cm | 18.8 | 16.1 | 16.7 | 17.8 | 15.2 | 8.1 | 7.2 |
| Small Print + try-on | 24.9 | 20.0 | 18.5 | 20.4 | 16.1 | 0 | 0 |

How close each distribution is to the field:

| Distribution | KS distance | Overlap |
|---|---|---|
| Sim ideal | 0.17 | 73.5% |
| Small Print + try-on | 0.27 | 72.8% |
| Small Print start | 0.15 | 80.0% |
| Age table | 0.31 | 64.5% |

The field share above +3.00 is 5.9%; the sim's is 15.3%.

### (c) Sensitivity: headline if our people aged like the field data (right call, everyone, ages 40–70)

How the accommodation centre was moved:

- **Half-reserve fit:** 3.2 / 2.1 / 1.2 / 0.4 / 0 D at age 40 / 45 / 50 / 55 / 60. Hofstetter's mean is 6.5 / 5.0 / 3.5 / 2.0 / 0.5.
- **Minimum-plus fit:** 1.3 D at 40, 0.65 D at 45, 0 from about 50.

| Method | Shipped population | Field-calibrated (half reserve) | Field-calibrated (minimum plus) | Shipped, upper tail re-weighted to field |
|---|---|---|---|---|
| Age table (40 cm) | 42.0% | 41.1% | 30.3% | 45.3% |
| Rack card at 14 in | 50.9% | 56.8% | 63.4% | 48.1% |
| Small Print start | 69.7% | 59.5% | 48.8% | 74.5% |
| **Small Print + try-on (0.50)** | **84.6%** | **83.2%** | **85.1%** | **85.1%** |
| Small Print + try-on (0.25) | 85.4% | 84.9% | 85.8% | 85.9% |

In-scope results for **Small Print + try-on (0.50)**:

| Population | Within ±0.25 | Within ±0.50 | Bias |
|---|---|---|---|
| Shipped | 71.8% | 84.6% | −0.09 D |
| Half reserve | 70.7% | 86.6% | −0.16 D |
| Minimum plus | 78.3% | 91.2% | −0.10 D |

**Age table, in scope within ±0.50:** 75.1% → 68.2% → 58.3%.

**Small Print start, referral sensitivity:** 41.0% → 27.4% → 21.4%. Far more people need more than +3.00, and the
start rarely refers them.

**By age, Small Print + try-on right call at 40–44:** 80.9% → 72.6% (half reserve).

## Interpretation

1. **For people who get readers, the power our virtual people need by age is realistic.** It is within about
   0.2 D of the Kenyan and Indian programme data on average. At 60+ it matches Kenya to within 0.03 D. The weak
   spot is 45–54, where the sim is 0.1–0.36 D below the field.
2. **Our population becomes presbyopic too late.** It uses Hofstetter's mean accommodation. The accommodation that
   fits Asmara's adds is what Hofstetter's mean predicts about 10 years later at 40–45, and about 5 years later at 55.
   The evidence:
   - In Asmara, 78% of 41–45-year-olds were presbyopic with a mean add of +1.30. In our population it is 0% and +0.08.
   - In Kenya, 28–34% of 40–49-year-olds failed a near screen even on presenting vision. In our population, 5–11% fail unaided.
   - The bench's existing "lower-amplitude" sensitivity (Hofstetter's minimum) does not close this gap.
   - Our population also has too many people above +3.00 (15% vs 6%), and a wider spread within each age band.
3. **Small Print's recommendations run weaker than what Kenyan clinicians dispensed:**
   - Try-on is about 0.3–0.5 D weaker in every age band, and 0–0.36 D weaker than India's optometrist.
   - Part of this is by design: above +3.00 the app refers rather than dispensing, and the rack protocol starts with the weaker pair.
   - Part is the population: our 45–54-year-olds need less.
   - It is consistent with the bench's known under-correction of uncorrected long sight.
   - It is not explained by reading distance: the app uses each person's measured distance, about 37 cm, which would push powers *up*, not down.
   - This is a signal to watch in a field study, not proof of error. Field powers are a clinician's choice, anchored on age, and made from 0.50 D stock.
4. **The try-on headline is robust; the other numbers are not.**
   - Small Print + try-on stays at 83–86% right call in every population tried, including the upper-tail reweighting.
   - The start alone (49–75%) and the age table (30–45%) depend strongly on which population is true. They should be quoted with that caveat.
   - Small Print + try-on's lead over the best baseline shrinks from +34 points to +22–26 points in the field-calibrated populations. The rack card improves there because almost nobody is "too young for readers".
5. **The calibrated runs bound the truth from above:**
   - The half-reserve fit overshoots the conditional powers at 40–59: by +0.22 to +0.35 D vs Kenya and +0.48 to +0.64 D vs India. The minimum-plus fit overshoots Kenya by up to +0.95 D.
   - The shipped population sits at or below Kenya in every band except 60–64 (+0.02 D).
   - A real programme's population probably lies between them. The try-on result holds across that whole range.

## Limitations

- **Field "required power" is not an optical ideal.**
  - It is what a clinician chose with ready-made readers at about 40 cm: ophthalmic clinical officers in Kenya, a single optometrist in India.
  - Those choices are likely anchored on age guidance and on 0.50 D stock (Kenya Fig. 1c has few quarter steps).
  - The criterion may be "reads N6/N8", not "half the accommodation in reserve".
- **Populations differ.**
  - Kenya, India and Eritrea, compared with a generic uniform 40–70 virtual population.
  - Their refractive-error and reading-distance distributions are unknown.
  - Kenya's Table 4 includes people who failed distance vision (25%). Our comparison group excludes myopes beyond −1.00.
- **Selection.**
  - Kenya and India include only people who failed a near screen and reached triage or the clinic. Our "needs readers" group approximates this.
  - Asmara is a clinic sample and measures add over full distance correction, a different quantity. That is why we show two readings.
- **Digitised and small numbers.**
  - Figure values are digitised. Medians that coincide with a box edge come from the authors' text.
  - India's sample is small (n = 378), mostly in their 40s, with per-band n unknown.
  - Kenya's 70+ counts are mapped to the sim's 65–70 band.
- **Scope of the check.**
  - This is a population-level plausibility check. It says nothing about whether any individual gets the right pair. That requires a field study with an optometrist reference, like source 2's design.
