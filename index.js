const fs = require('fs');
const path = require('path');
const loaderUtils = require('loader-utils');
const LineDiff = require('line-diff');

const bannerMessage =
  '// This file is automatically generated.\n// Please do not change this file!';

const cssModuleExport = 'export const cssExports: CssExports;\nexport default cssExports;\n';
const cssNamedModuleExport = 'export const cssExports: CssExports;\nexport = cssExports;\n';

const getNoDeclarationFileError = ({ filename }) =>
  new Error(
    `Generated type declaration does not exist. Run webpack and commit the type declaration for '${filename}'`
  );

const getTypeMismatchError = ({ filename, expected, actual }) => {
  const diff = new LineDiff(enforceLFLineSeparators(actual), expected).toString();

  return new Error(
    `Generated type declaration file is outdated. Run webpack and commit the updated type declaration for '${filename}'\n\n${diff}`
  );
};

const cssModuleToInterface = (cssModuleKeys) => {
  const interfaceFields = cssModuleKeys
    .sort()
    .map(key => `  '${key}': string;`)
    .join('\n');

  return `interface CssExports {\n${interfaceFields}\n}`;
};

const filenameToTypingsFilename = filename => {
  const dirName = path.dirname(filename);
  const baseName = path.basename(filename);
  return path.join(dirName, `${baseName}.d.ts`);
};

const enforceLFLineSeparators = text => {
  if (text) {
    // replace all CRLFs (Windows) by LFs (Unix)
    return text.replace(/\r\n/g, "\n");
  } else {
    return text;
  }
};

const compareText = (contentA, contentB) => {
  return enforceLFLineSeparators(contentA) === enforceLFLineSeparators(contentB);
};

const validModes = ['emit', 'verify'];

const isFileNotFound = err => err && err.code === 'ENOENT';

const makeDoneHandlers = (callback, content, rest) => ({
  failed: e => callback(e),
  success: () => callback(null, content, ...rest)
});

const makeFileHandlers = filename => ({
  read: handler => fs.readFile(filename, { encoding: 'utf-8' }, handler),
  write: (content, handler) =>
    fs.writeFile(filename, content, { encoding: 'utf-8' }, handler)
});

function* extractLocalExports(content) {
  let localExports = content.split('exports.locals = {')[1];
  if (!localExports) {
    localExports = content.split('___CSS_LOADER_EXPORT___.locals = {')[1];
  }
  if (localExports) {
    // // Exports
    // ___CSS_LOADER_EXPORT___.locals = {
    //   "class": `class__file`,
    const keyRegex = /"([^\\"]+)":/g;
    let match;
    while ((match = keyRegex.exec(localExports))) {
      yield match[1];
    }
  } else {
    // export { _1 as "class" };
    const keyRegex = /export { [_a-z0-9]+ as ("[^\\"]+") }/g;
    while ((match = keyRegex.exec(content))) {
      yield JSON.parse(match[1]);
    }
  }
}

module.exports = function(content, ...rest) {
  const { failed, success } = makeDoneHandlers(this.async(), content, rest);

  const filename = this.resourcePath;
  const { mode = 'emit', namedExports = false } = loaderUtils.getOptions(this) || {};
  if (!validModes.includes(mode)) {
    return failed(new Error(`Invalid mode option: ${mode}`));
  }

  const cssModuleInterfaceFilename = filenameToTypingsFilename(filename);
  const { read, write } = makeFileHandlers(cssModuleInterfaceFilename);

  const cssModuleKeys = [];
  for (const key of extractLocalExports(content)) {
    // Do you really need this existence check?
    if (cssModuleKeys.indexOf(key) < 0) {
      cssModuleKeys.push(key);
    }
  }

  const exportsDeclaration = namedExports ? cssNamedModuleExport : cssModuleExport;
  const cssModuleDefinition = `${bannerMessage}\n${cssModuleToInterface(cssModuleKeys)}\n${exportsDeclaration}`;

  if (mode === 'verify') {
    read((err, fileContents) => {
      if (isFileNotFound(err)) {
        return failed(
          getNoDeclarationFileError({
            filename: cssModuleInterfaceFilename
          })
        );
      }

      if (err) {
        return failed(err);
      }

      if (!compareText(cssModuleDefinition, fileContents)) {
        return failed(
          getTypeMismatchError({
            filename: cssModuleInterfaceFilename,
            expected: cssModuleDefinition,
            actual: fileContents
          })
        );
      }

      return success();
    });
  } else {
    read((_, fileContents) => {
      if (!compareText(cssModuleDefinition, fileContents)) {
        write(cssModuleDefinition, err => {
          if (err) {
            failed(err);
          } else {
            success();
          }
        });
      } else {
        success();
      }
    });
  }
};
