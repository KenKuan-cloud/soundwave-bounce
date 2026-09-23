// Acoustics formulas. Units: metres, seconds, Hz, °C, kPa, dB.

// Speed of sound in dry air.
function speedOfSound(tempC) {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

// Sensors convert time to distance with a fixed speed of sound (20 °C).
// A different air temperature therefore shows up as a distance error.
const C_ASSUMED = speedOfSound(20);

// Atmospheric absorption, ISO 9613-1. Returns dB per metre.
function airAbsorptionDbPerM(fHz, tempC, humidityPct, pressureKPa) {
  const T = tempC + 273.15;
  const T0 = 293.15;
  const T01 = 273.16;
  const pr = 101.325;
  const pa = pressureKPa;
  const psatRatio = Math.pow(10, -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151);
  const h = humidityPct * psatRatio / (pa / pr);
  const frO = (pa / pr) * (24 + 4.04e4 * h * (0.02 + h) / (0.391 + h));
  const frN = (pa / pr) * Math.pow(T / T0, -0.5) *
    (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T / T0, -1 / 3) - 1)));
  const f2 = fHz * fHz;
  return 8.686 * f2 * (
    1.84e-11 * (pr / pa) * Math.sqrt(T / T0) +
    Math.pow(T / T0, -2.5) * (
      0.01275 * Math.exp(-2239.1 / T) / (frO + f2 / frO) +
      0.1068 * Math.exp(-3352 / T) / (frN + f2 / frN)
    )
  );
}

// Bessel J1 (Numerical Recipes rational approximation).
function besselJ1(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const a2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a1 / a2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const b1 = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const b2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * b1 - z * Math.sin(xx) * b2);
  return x < 0 ? -ans : ans;
}

// Baffled circular piston. The beam half-angle is taken as the −6 dB point,
// where 2·J1(x)/x = 0.5, i.e. x ≈ 2.215.
function pistonKa(halfAngleDeg) {
  return 2.215 / Math.sin(clamp(halfAngleDeg, 1, 89) * DEG);
}

// Power directivity (0..1) at angle theta (radians) off-axis.
function pistonPower(ka, theta) {
  if (theta >= Math.PI / 2) return 0;
  const x = ka * Math.sin(theta);
  if (Math.abs(x) < 1e-6) return 1;
  const d = 2 * besselJ1(x) / x;
  return d * d;
}

// Rays are launched out to the second null, so the first side lobe
// (−17.6 dB, what usually "sees" the floor) is included.
function pistonMaxAngle(ka) {
  return ka > 7.0156 ? Math.asin(7.0156 / ka) : Math.PI / 2;
}
