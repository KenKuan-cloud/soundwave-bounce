// Entry point.
store.loadPreset('demo');

const viewport = createViewport(document.getElementById('viewport'));
let sim = null;
const echoChart = createEchoChart(document.getElementById('echo-chart'), { onScrub: (t) => sim?.scrub(t) });
const historyChart = createHistoryChart(document.getElementById('history-chart'));
sim = createSim({ viewport, echoChart, historyChart });
const ui = initUI({ viewport, sim });

viewport.rebuild();
viewport.setView('persp');
ui.renderOutliner();
ui.showInspector();
ui.fillAll();
sim.retrace();
