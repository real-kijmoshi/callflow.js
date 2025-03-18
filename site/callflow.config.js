const callflow = require("callflow");

const start = Date.now();
let clicksThisSession = 0;

callflow.exposeFunction("click", [], () => {
  clicksThisSession++;
  return clicksThisSession;
});

callflow.exposeFunction("getClicks", [], () => {
  return clicksThisSession;
});

callflow.exposeFunction("uptime", [], () => {
  return (Date.now() - start) / 1000;
});