

document.addEventListener('joplin-mathJaxLoad', (event) => {
    console.log(`fix mathjax heaer`)
    MathJax = {
        tex: {
            packages: { '[+]': ['ams'] },
            inlineMath: [['$', '$'], ['\\(', '\\)']],
            displayMath: [['$$', '$$'], ['\\[', '\\]']],
        },
        chtml: {
            // カスタムスタイルを空に設定してデフォルトスタイルを無効にする
            styles: {}
        }
    };
});



document.addEventListener('joplin-mathJaxUpdate', (event) => {
    console.log(`joplin-mathJaxUpdate event triggered!`);
    const targetId = event.detail.id;
    const target = document.getElementById(targetId);
    MathJax.typesetPromise([target]);
    console.log(`fiinished typesetting!. id: ${targetId}`);
});
