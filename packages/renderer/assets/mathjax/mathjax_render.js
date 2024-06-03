document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const target = document.getElementById(targetId);
    MathJax.typesetPromise([target]);
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
