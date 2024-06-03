document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const target = document.getElementById(targetId);
    MathJax.Hub.Typeset(target);
    console.log(`fiinished typesetting!. id: ${targetId}`);
});




const removeMathJaxStyleTimerFunc = (document, count) => {
    let mathJaxStyleTimerRef = null;
    return () => {
        removeMathjaxStyleTimer(document, count, mathJaxStyleTimerRef);
    }
}

const removeMathjaxStyleTimer = (document, count, mathJaxStyleTimerRef) => {
    if (mathJaxStyleTimerRef !== null) {
        clearTimeout(mathJaxStyleTimerRef);
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
            removeMathjaxStyleTimer(document, count + 1, mathJaxStyleTimerRef);
        }, 500);
        return;
    }
    sheet.parentNode.removeChild(sheet);
    console.log('success removeMathjaxStyle');
};

document.addEventListener('joplin-mathJaxOnload', (event) => {
    const timerFunc = removeMathJaxStyleTimerFunc(document, 0);
    timerFunc();
});
