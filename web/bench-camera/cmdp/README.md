# Real-people check: Caltech Multi-Distance Portraits (CMDP)

This folder runs the app's own camera distance code on a public dataset of real people that we did not record.
It writes `public/data/cmdp.json`, `public/figures/cmdp-distance.svg` and `public/figures/cmdp-iris.svg`.
These outputs hold numbers and charts only. No image, crop or subject code from the dataset goes into the repo or onto the site.

## Dataset

- Caltech Multi-Distance Portraits (CMDP). Burgos-Artizzu, Ronchi, Perona, *Distance Estimation of an Unknown Person from a Portrait*, ECCV 2014, doi:10.1007/978-3-319-10590-1_21.
- Record: https://data.caltech.edu/records/n5vnm-mqr05 (doi:10.22002/D1.20110). Licence: CC-BY on CaltechDATA. The files' own `bsd.txt` gives the Simplified BSD License.
- Contents: 51 people, each photographed at 7 floor-marked distances of 2, 3, 4, 6, 8, 12 and 16 ft (61–488 cm), which makes 357 original portraits.
- Camera: EXIF says Canon EOS D60 (the paper says Rebel XTi) with a 28–300 mm zoom. The sensor is 22.66 mm wide, from EXIF FocalPlaneXResolution.
- The photographer re-zoomed for every photo to fill the frame with the face. That is why the analysis divides out the EXIF focal length.
- 8 people's photos (2056×3088) have no EXIF. They count only for detection, the eye check and the label-free check.

## Steps (Windows, Git Bash; about 10 minutes)

1. Download the dataset outside the repo and check the md5 sums. The download is about 614 MB, and you need about 650 MB more to unzip it.

   ```bash
   mkdir -p "$TEMP/cmdp" && cd "$TEMP/cmdp"
   for f in CMDP-ANNO.zip CMDP_1.zip CMDP_2.zip; do
     curl -sSL -o "$f" "https://data.caltech.edu/api/records/n5vnm-mqr05/files/$f/content"
   done
   md5sum *.zip
   # ca117c8ba92f68a2a8191c0510cb88b0  CMDP-ANNO.zip
   # 7d9a19c26fe92f894e88ace8de8c7fc6  CMDP_1.zip
   # 18023d525d3b7924b57840704852b30a  CMDP_2.zip
   unzip -q CMDP-ANNO.zip -d anno && unzip -q CMDP_1.zip -d img && unzip -q CMDP_2.zip -d img
   ```

   This gives `$TEMP/cmdp/img/CMDP_1/<n>_<id>/<id>_<feet>.jpg` and the same layout under `CMDP_2`. To use another folder, set `CMDP_DIR` to the folder that contains `CMDP_1` and `CMDP_2`.

2. Collect the measurements from `web/`. You need Google Chrome installed and `public/mediapipe/wasm` in place (run `node scripts/copy-mediapipe.mjs` once).

   ```bash
   npx tsx bench-camera/cmdp/run.ts                   # GPU delegate (as the app), ≈ 2 min
   CMDP_DELEGATE=CPU npx tsx bench-camera/cmdp/run.ts # optional CPU cross-check → raw-cpu.json
   ```

   `run.ts` starts a Vite dev server on port 4196 using `bench-camera/cmdp/vite.config.ts`, with root `web/`. The dataset photos are served read-only from `CMDP_DIR` to 127.0.0.1 only.

   It then opens `bench-camera/cmdp/harness.html` in headless Chrome through Playwright (channel `chrome`). For each photo, the harness runs:
   - MediaPipe Face Landmarker in IMAGE mode with `public/models/face_landmarker.task`;
   - `irisWidthNorm()`, imported unchanged from `src/camera/distance.ts`;
   - the app's eye-visibility check, using `eyePatchContrast()`, `EYE_PATCH_PX` and `EYE_MIN_CONTRAST`, also imported unchanged.

   The script reads EXIF with `exif.ts` (no dependency) and writes `$TEMP/cmdp/raw.json`, which holds numbers only.

3. Analyse:

   ```bash
   npx tsx bench-camera/cmdp/report.ts
   ```

## What is computed

- **θ** is the iris size divided by the focal length: θ = iris px ÷ (EXIF focal length mm × 135.59 px/mm). In this formula, iris px = `irisWidthNorm` × image width.
- **Calibrated distance (the app's method).** For each person, k = d(2 ft) × θ(2 ft). The other six distances are then predicted as d = k ÷ θ. The app uses irisNorm where this check uses θ, because CMDP changed the zoom between photos.
- **Uncalibrated distance.** d = 11.7 mm ÷ θ. Compare this with the 4.3% mean error that Google reported for MediaPipe Iris.
- **Implied iris diameter.** For each person, d × θ is averaged over the 12 ft and 16 ft photos.
- **Label-free check.** Iris width ÷ inter-pupil distance (landmarks 468–473) should be the same in all 7 photos of a person. This check needs no distance and no focal length.
- **Distance-reference offset δ.** The CMDP distances are floor marks for the monopod foot, and their exact reference points are not documented. Taken at face value, d × θ falls steadily with distance, but the whole face shrinks the same way. A single offset δ (mark + δ = camera-to-eye distance) is fitted to make d × θ constant within each person. For the calibrated errors, δ is refit leaving out the person being tested. `cmdp.json` reports both versions: the marks as given and the marks corrected by δ.

## Limits

- The dataset covers 61–488 cm with a zoom lens. The app works at 25–70 cm with a fixed phone camera. So this checks the physics and the landmark model on real faces, not the app's exact use.
- Each photo's EXIF focal length (which comes in coarse steps, e.g. 28 → 33 → 35 mm), focus breathing and the undocumented reference points all add error that the app does not have.
- The paper says the images were "cropped and resampled to a common format".
- The photos are still, frontal and evenly lit, against a blue background.
