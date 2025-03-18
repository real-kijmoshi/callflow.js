const callbackFunctions = {
  exposeFunction: null,
  exposeVariable: null,
};

const callflow = {
  exposeFunction: function (name, args, fn) {
    if (callbackFunctions.exposeFunction) {
      callbackFunctions.exposeFunction(name, args, fn);
    } else {
      console.error(
        "CallFlow not initialized. This function might not work properly.",
      );
    }
  },
  exposeVariable: function (name, value) {
    if (callbackFunctions.exposeVariable) {
      callbackFunctions.exposeVariable(name, value);
    } else {
      console.error(
        "CallFlow not initialized. This function might not work properly.",
      );
    }
  },
  _setCallbacks: function (exposeFunction, exposeVariable) {
    callbackFunctions.exposeFunction = exposeFunction;
    callbackFunctions.exposeVariable = exposeVariable;
  },
};

module.exports = callflow;
