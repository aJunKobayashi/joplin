MathJax = {
    startup: {
        typeset: false
    },
    displayAlign: "left"
};    

document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const target = document.getElementById(targetId);
    const tex = target.innerText;
    const mml = MathJax.tex2mml(tex, {display: false});
    target.innerHTML = mml;
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
