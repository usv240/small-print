# Simulated-eye test bench: summary

> **SIMULATION: virtual people generated from published norms and stated assumptions. Not clinical validation; no real participants.**
> Full method, equations and every assumption: `sim/README.md`. Raw numbers: `/data/bench.json`.

bench 1.0.0 · core sha256:345c07e2c4e5 · seed 20261003 · 20,000 virtual people aged 40–70 · generated 2026-10-01T21:47:23.890Z

Population: 10,763 in scope for ready-made readers (ideal +0.75 to +3.00), 3,233 don't need readers yet, 2,036 should be referred for myopia (< −1.00 D), 3,968 need more than +3.00.

## Headline (main scenario)

"Right call, everyone" is over **all** virtual people: a pair within ±0.50 D of ideal if they need one, no readers if they should be referred or don't need readers yet. The other accuracy columns are over **in-scope** people (anyone told "no readers" or referred counts as a miss). Bias and mean |error| are over in-scope people who were given a pair (+ = too strong). Referral sensitivity = share of people who should be referred who were **not** handed readers.

| Method | right call, everyone (±0.50) | within ±0.25 | within ±0.50 | exact | bias (D) | mean abs. error (D) | referral sensitivity | myopes handed readers | handed readers but don't need them yet |
|---|---|---|---|---|---|---|---|---|---|
| Age table (40 cm) | 42.0% | 49.4% | 75.1% | 16.5% | +0.07 | 0.45 | 0.0% | 100.0% | 100.0% |
| Age table + measured distance | 43.1% | 42.2% | 63.2% | 15.3% | +0.28 | 0.51 | 22.3% | 88.7% | 87.1% |
| Rack card at 14 in | 50.9% | 47.2% | 63.9% | 16.9% | −0.38 | 0.51 | 42.4% | 99.9% | 100.0% |
| Rack card where they read | 52.1% | 46.7% | 64.3% | 16.5% | −0.43 | 0.51 | 45.8% | 99.9% | 100.0% |
| Small Print start | 69.7% | 58.7% | 80.1% | 21.7% | +0.05 | 0.33 | 41.0% | 33.0% | 18.4% |
| Small Print + try-on (0.50 stock) | 84.6% | 71.8% | 84.6% | 30.9% | −0.09 | 0.25 | 80.0% | 11.1% | 17.0% |
| Small Print + try-on (0.25 stock) | 85.4% | 74.0% | 86.6% | 32.2% | −0.03 | 0.24 | 80.4% | 10.9% | 17.2% |

What-if variants (**not shipped**) and a reference ceiling:

| Method | right call, everyone (±0.50) | within ±0.25 | within ±0.50 | exact | bias (D) | mean abs. error (D) | referral sensitivity | myopes handed readers | handed readers but don't need them yet |
|---|---|---|---|---|---|---|---|---|---|
| What-if: try-on + probe pair (0.50 stock) | 84.9% | 72.9% | 85.0% | 31.6% | −0.10 | 0.25 | 80.1% | 11.1% | 17.0% |
| What-if: try-on + probe pair (0.25 stock) | 86.1% | 76.7% | 87.2% | 34.7% | −0.04 | 0.22 | 80.6% | 10.9% | 17.0% |
| What-if: far end estimated from lens power (0.50 stock) | 84.0% | 69.6% | 81.6% | 30.6% | −0.13 | 0.25 | 80.1% | 10.8% | 4.3% |
| Reference: ideal pair, 0.50 stock | 100.0% | 100.0% | 100.0% | 50.1% | +0.12 | 0.12 | 100.0% | 0.0% | 0.0% |

With the shipped try-on, 52.6% of try-on measurements had the far end of clear vision beyond arm's reach, where `assessTryOn()` can only answer "good" or "stronger".

## Sensitivity

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Shared camera distance error SD 0% (+1% per reading) | 49.4% / 75.1% | 59.8% / 81.0% | 72.5% / 85.1% | 74.7% / 87.3% |
| Shared camera distance error SD 2% (+1% per reading) | 49.4% / 75.1% | 59.6% / 80.8% | 72.4% / 85.0% | 74.8% / 87.1% |
| Shared camera distance error SD 4% (+1% per reading) | 49.4% / 75.1% | 58.7% / 80.1% | 71.8% / 84.6% | 74.0% / 86.6% |
| Shared camera distance error SD 8% (+1% per reading) | 49.4% / 75.1% | 55.7% / 77.4% | 69.6% / 82.7% | 71.7% / 85.0% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Independent per-reading distance error SD 0% | 49.4% / 75.1% | 59.8% / 81.2% | 72.7% / 85.4% | 74.9% / 87.3% |
| Independent per-reading distance error SD 2% | 49.4% / 75.1% | 59.5% / 80.5% | 71.8% / 84.6% | 73.8% / 86.8% |
| Independent per-reading distance error SD 4% | 49.4% / 75.1% | 58.3% / 79.4% | 68.9% / 83.1% | 71.0% / 85.5% |
| Independent per-reading distance error SD 8% | 49.4% / 75.1% | 53.9% / 75.0% | 60.1% / 77.2% | 61.8% / 79.2% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Everyone's true depth of focus 0.30 D (app assumes 0.50 D) | 49.4% / 75.1% | 57.0% / 79.3% | 73.1% / 85.2% | 75.1% / 87.0% |
| Everyone's true depth of focus 0.50 D (app assumes 0.50 D) | 49.4% / 75.1% | 58.0% / 79.9% | 72.9% / 85.3% | 74.7% / 87.2% |
| Everyone's true depth of focus 0.75 D (app assumes 0.50 D) | 49.4% / 75.1% | 59.2% / 80.3% | 71.5% / 84.6% | 73.7% / 86.8% |
| Everyone's true depth of focus 1.00 D (app assumes 0.50 D) | 49.4% / 75.1% | 59.8% / 80.4% | 69.0% / 83.4% | 72.0% / 85.8% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Blur-judgement error SD 0.00 D | 49.4% / 75.1% | 58.9% / 80.7% | 76.5% / 85.8% | 78.0% / 87.8% |
| Blur-judgement error SD 0.25 D | 49.4% / 75.1% | 58.7% / 80.1% | 71.8% / 84.6% | 74.0% / 86.6% |
| Blur-judgement error SD 0.50 D | 49.4% / 75.1% | 57.3% / 78.5% | 61.8% / 79.1% | 64.6% / 81.9% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Lower-amplitude population (centred on Hofstetter minimum) | 49.8% / 76.0% | 59.8% / 80.7% | 70.4% / 84.2% | 74.2% / 86.9% |
| Accommodation SD 0.5 D | 49.5% / 75.5% | 58.6% / 80.2% | 71.5% / 84.7% | 73.8% / 86.7% |
| Accommodation SD 1.0 D | 48.8% / 74.7% | 58.8% / 80.3% | 71.6% / 84.9% | 74.1% / 86.8% |
| Everyone emmetropic (no refractive error) | 54.1% / 77.4% | 72.4% / 92.1% | 84.5% / 94.2% | 80.1% / 94.1% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Holding distance varies 5% between capture and real reading | 49.4% / 75.1% | 56.2% / 77.8% | 67.4% / 82.4% | 69.5% / 84.3% |
| Arm-stretch: phone held halfway out to the no-glasses near point during capture | 49.4% / 75.1% | 48.4% / 73.0% | 38.6% / 59.5% | 42.2% / 65.8% |

| Scenario | Age table (40 cm) ±0.25 / ±0.50 | Small Print start ±0.25 / ±0.50 | Small Print + try-on (0.50 stock) ±0.25 / ±0.50 | Small Print + try-on (0.25 stock) ±0.25 / ±0.50 |
|---|---|---|---|---|
| Perfect measurements (no noise) | 49.4% / 75.1% | 59.8% / 81.5% | 78.0% / 86.4% | 79.3% / 88.4% |
| Perfect measurements + 5 m reach (far end always measurable) | 49.4% / 75.1% | 65.7% / 85.6% | 90.2% / 92.5% | 90.8% / 92.7% |
| Perfect measurements + 5 m reach + no refractive error | 54.1% / 77.4% | 82.3% / 98.4% | 99.3% / 99.3% | 99.3% / 99.3% |

## Breakdown by age (main scenario)

Cells: right call for everyone (±0.50) · in-scope within ±0.50.

| Age | Age table (40 cm) | Age table + measured distance | Rack card at 14 in | Rack card where they read | Small Print start | Small Print + try-on (0.50 stock) | Small Print + try-on (0.25 stock) |
|---|---|---|---|---|---|---|---|
| 40–44 | 30.8% · 73.5% | 32.1% · 55.4% | 30.8% · 73.5% | 30.9% · 73.6% | 78.1% · 45.7% | 80.9% · 43.6% | 81.3% · 46.0% |
| 45–49 | 38.2% · 68.5% | 31.3% · 55.2% | 45.7% · 64.6% | 45.7% · 64.6% | 79.0% · 81.2% | 82.1% · 78.9% | 83.9% · 83.2% |
| 50–54 | 43.2% · 58.9% | 39.6% · 51.7% | 44.1% · 51.4% | 43.8% · 50.9% | 72.1% · 87.3% | 84.8% · 90.2% | 85.3% · 93.2% |
| 55–59 | 49.0% · 72.4% | 47.8% · 57.8% | 51.1% · 58.8% | 49.1% · 54.0% | 67.6% · 81.4% | 86.6% · 92.4% | 87.6% · 93.6% |
| 60–64 | 45.6% · 92.3% | 53.2% · 81.4% | 66.8% · 74.3% | 71.1% · 77.8% | 60.1% · 83.3% | 86.3% · 91.0% | 86.7% · 91.8% |
| 65–70 | 45.2% · 94.8% | 54.7% · 84.0% | 67.4% · 72.9% | 72.8% · 79.7% | 61.2% · 84.7% | 87.2% · 91.1% | 87.8% · 91.3% |

## Breakdown by uncorrected refractive error (main scenario)

Cells: in-scope within ±0.25 / ±0.50 (bias D); for the myopia group: referral sensitivity.

| Refractive error | n in scope | Age table (40 cm) | Age table + measured distance | Rack card at 14 in | Rack card where they read | Small Print start | Small Print + try-on (0.50 stock) | Small Print + try-on (0.25 stock) |
|---|---|---|---|---|---|---|---|---|
| myopia < −1.00 (refer) | 0 | refer-sens 0.0% | refer-sens 11.3% | refer-sens 0.1% | refer-sens 0.1% | refer-sens 67.0% | refer-sens 88.9% | refer-sens 89.1% |
| low myopia −1.00 to −0.26 | 1652 | 35.1% / 57.1% (+0.54) | 15.4% / 36.7% (+0.80) | 61.8% / 82.4% (−0.12) | 64.2% / 85.0% (−0.17) | 22.0% / 56.8% (+0.56) | 77.2% / 88.9% (+0.07) | 75.0% / 88.2% (+0.11) |
| near zero −0.25 to +0.75 | 7060 | 54.1% / 81.4% (+0.09) | 46.7% / 66.9% (+0.31) | 49.7% / 66.8% (−0.32) | 49.1% / 67.6% (−0.37) | 73.0% / 91.6% (+0.06) | 82.2% / 92.8% (−0.02) | 82.9% / 93.5% (+0.04) |
| low hyperopia +0.76 to +2.00 | 1823 | 49.6% / 75.0% (−0.30) | 53.9% / 77.9% (−0.09) | 30.1% / 43.2% (−0.71) | 26.9% / 39.9% (−0.74) | 43.7% / 66.5% (−0.39) | 35.5% / 59.6% (−0.46) | 47.7% / 69.6% (−0.36) |
| hyperopia > +2.00 | 228 | 4.4% / 11.0% (−1.20) | 3.1% / 18.9% (−1.02) | 1.8% / 7.0% (−1.36) | 1.8% / 6.1% (−1.39) | 0.0% / 1.3% (−1.19) | 0.0% / 0.9% (−1.30) | 0.0% / 1.3% (−1.19) |

## What-if: possible-myopia threshold in `recommend()`

Refer when measured amplitude > Hofstetter maximum + margin (shipped margin 1.5 D). Tuned against our own simulated truth.

| Margin (D) | Myopes handed readers (start / after try-on) | Referral sensitivity after try-on | In-scope wrongly referred after try-on | Right call, everyone, after try-on |
|---|---|---|---|---|
| 0.50 | 17.7% / 6.7% | 81.5% | 5.0% | 84.2% |
| 0.75 | 20.4% / 7.6% | 81.2% | 4.3% | 84.6% |
| 1.00 | 24.5% / 8.1% | 81.0% | 3.9% | 84.8% |
| 1.50 (shipped) | 33.0% / 11.1% | 80.0% | 3.6% | 84.6% |

## Ages 35–39 (supplementary, 5,000 virtual people)

3,883 don't need readers yet, 570 in scope (mostly uncorrected long sight), 536 myopic. Share of people who don't need readers who were handed a pair anyway: Age table (40 cm) 100.0%, Small Print start 2.3%, Small Print + try-on (0.50 stock) 2.3%.

## What-if: near-point weight in `recommend()` (start only)

Tuned against our own simulated truth: if a new weight is adopted, say so. Cells: within ±0.25 / within ±0.50 / bias.

| Weight on near point | Main population | Lower-amplitude population |
|---|---|---|
| 0.0 | 42.2% / 63.2% / +0.29 | 49.0% / 71.2% / +0.11 |
| 0.2 | 47.0% / 69.9% / +0.21 | 52.5% / 75.5% / +0.07 |
| 0.4 | 52.6% / 76.3% / +0.13 | 56.2% / 78.8% / +0.02 |
| 0.6 (shipped) | 58.7% / 80.1% / +0.05 | 59.8% / 80.7% / −0.03 |
| 0.8 | 59.2% / 78.1% / −0.03 | 60.2% / 80.1% / −0.07 |
| 1.0 | 54.2% / 72.3% / −0.10 | 57.8% / 77.0% / −0.12 |
