

document.addEventListener('joplin-kartexUpdate', (event) => {
    console.log(`joplin-kartexUpdate event triggered!`);
    const targetId = event.detail.id;
    const fontSize = event.detail.fontSize;
    const target = document.getElementById(targetId);
    renderMathInElement(target);
    target.firstChild.style.fontSize = `${fontSize}px`;
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
