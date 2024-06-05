MathJax = {
    startup: {
        typeset: false
    },
    displayAlign: "left"
};    

document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const fontSize = event.detail.fontSize;
    const target = document.getElementById(targetId);
    const tex = target.innerText;
    const container = MathJax.tex2svg(tex, { display: false });
    const [svg] = container.children;
    target.appendChild(svg);
    const mathTag = target.firstChild;
    mathTag.style.fontSize = `${fontSize}px`;
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
