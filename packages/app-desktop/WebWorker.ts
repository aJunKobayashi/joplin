
// import { revertResourceDirToJoplinScheme } from './commands/showBrowser';
// eslint-disable-next-line no-undef
importScripts('./commands/showBrowser.js');


// worker.js
self.onmessage = function(e) {
	console.log(`work received: ${JSON.stringify(e.data, null, 2)}`);


	const newData = revertResourceDirToJoplinScheme(e.data.md, e.data.resourceDir);
	(self as any).postMessage(newData);
};
