
let gTimerStart = false;


// worker.js
self.onmessage = function(e) {
	let counter = 1;
	const result = e.data * 2; // Example operation
	console.log(`work received: ${e.data}, result: ${result}`);
	(self as any).postMessage(result);
	if (!gTimerStart) {
		gTimerStart = true;
		setInterval(() => {
			// console.log(`worker counter: ${counter}`);
			(self as any).postMessage(counter);
			counter++;
		}, 10_000);

	}
};
