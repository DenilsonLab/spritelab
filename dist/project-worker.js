// JSON work stays off the editing thread. No network requests or storage.
self.onmessage = async ({ data }) => {
  const { id, task, payload } = data;
  try {
    let result;
    if (task === "serialize")
      result = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
    else if (task === "parse") {
      if (payload.size > 100 * 1024 * 1024)
        throw Error("El proyecto supera 100 MB.");
      result = JSON.parse(await payload.text());
    } else throw Error("Operación desconocida.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
