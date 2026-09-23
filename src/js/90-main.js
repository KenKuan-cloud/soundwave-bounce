// Entry point.
const viewport = createViewport(document.getElementById('viewport'));
createEchoChart(document.getElementById('echo-chart'));
initUI({ viewport });
viewport.select('sensor1');
