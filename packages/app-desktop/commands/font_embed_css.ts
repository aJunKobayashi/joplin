/* eslint-disable import/prefer-default-export */
import postcss from 'postcss';
import * as fs from 'fs';
import { basename, dirname } from 'path';
import path = require('path');

const encodeFont = (fontPath: string): string | null => {
	console.log(`fontPath: ${fontPath}`);
	try {
		const fontData = fs.readFileSync(fontPath);
		return `data:font/woff2;base64,${fontData.toString('base64')}`;
	} catch (err) {
		console.log(`err: ${err}`);
		const fontfile = basename(fontPath);
		const foldername = basename(dirname(fontPath));
		const relPath = [foldername, fontfile].join('/');
		return relPath;
	}
};



const customPlugin: postcss.Plugin = {
	postcssPlugin: 'custom-plugin',
	Once(root) {
		root.walkAtRules('font-face', rule => {
			rule.walkDecls('src', decl => {
				console.log(`decl.value: ${decl.value}`);

				const urlRegex = /url\((.*?)\)/g;
				const urls = decl.value.match(urlRegex)?.map(match => {
					const urlMatch = /url\((['"]?)(.*?)\1\)/.exec(match);
					return urlMatch ? urlMatch[2] : null;
				}).filter(url => url !== null) as string[];

				const formatRegex = /format\((.*?)\)/g;
				const formats = decl.value.match(formatRegex)?.map(match => {
					const formatMatch = /format\((['"]?)(.*?)\1\)/.exec(match);
					return formatMatch ? formatMatch[2] : null;
				}).filter(format => format !== null) as string[];



				console.log(`urls: ${urls}`);
				console.log(`formats: ${formats}`);
				const newValues = urls?.map((url, index) => {
					const fontPath = path.resolve('./test_file', url);
					const newValue = `url(${encodeFont(fontPath)}) format('${formats[index]}')`;
					return newValue;
				});
				decl.value = newValues?.join(', ') || decl.value;
			});
		});
	},
};

export const createEmbededFontCss = async (cssFilePath: string, outputPath: string): Promise<string> => {
	const inputCss = fs.readFileSync(cssFilePath, 'utf8');
	const result = await postcss([customPlugin]).process(inputCss, { from: cssFilePath, to: outputPath });
	return result.css;
};




