

// worker.js
self.onmessage = function(e) {
	const result = e.data * 2; // Example operation
	console.log(`work received: ${e.data}, result: ${result}`);
	(self as any).postMessage(result);
};
