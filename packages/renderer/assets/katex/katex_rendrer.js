

document.addEventListener('joplin-kartexUpdate', (event) => {
    console.log(`joplin-kartexUpdate event triggered!`);
    const targetId = event.detail.id;
    const fontSize = event.detail.fontSize;
    const target = event.detail.element;
    renderMathInElement(target);
    const elements = target.querySelectorAll(`.katex-display>.katex `);
    for(let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.setProperty('text-align', 'left', 'important');
        element.style.setProperty('font-size', `${fontSize}em`, 'important');
    }
    
    // target.firstChild.style.fontSize = `${fontSize}px`;
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
