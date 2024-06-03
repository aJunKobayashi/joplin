document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const target = document.getElementById(targetId);
    MathJax.typesetPromise([target]);
    console.log(`fiinished typesetting!. id: ${targetId}`);
});


let mathJaxStyleTimerRef = null;

const removeMathjaxStyleTimer = (document, count) => {
    if (mathJaxStyleTimerRef !== null) {
        clearTimeout(mathJaxStyleTimerRef.current);
        mathJaxStyleTimerRef = null;
    }
    console.log(`removeMathjaxTimer is called ${count} times.`);
    const sheet = document.querySelector('#MJX-CHTML-styles');
    if (!sheet) {
        if (count > 20) {
            console.log('timeout cannot removeMathjaxStyle');
            return;
        }
        mathJaxStyleTimerRef = setTimeout(() => {
            removeMathjaxStyleTimer(document, count + 1);
        }, 500);
        return;
    }
    sheet.parentNode.removeChild(sheet);
    console.log('success removeMathjaxStyle');
};

document.addEventListener('joplin-mathJaxOnload', (event) => {
    removeMathjaxStyleTimer(document, 0);
});
