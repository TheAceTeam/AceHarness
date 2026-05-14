import type { languages } from "monaco-editor"

export const cangjieLanguageId = "cangjie"

export const cangjieLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
    ["<", ">"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
}

export const cangjieMonarchLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".cj",

  keywords: [
    "package", "import", "class", "interface", "struct", "enum", "extend",
    "func", "let", "var", "type", "init", "this", "super",
    "if", "else", "case", "try", "catch", "finally",
    "for", "do", "while", "throw", "return", "continue", "break",
    "is", "as", "in", "match", "where", "spawn", "synchronized",
    "macro", "quote", "static", "internal", "external", "operator",
    "foreign", "inout", "mut", "unsafe", "prop", "main",
  ],

  typeKeywords: [
    "Int8", "Int16", "Int32", "Int64",
    "UInt8", "UInt16", "UInt32", "UInt64",
    "Float16", "Float32", "Float64",
    "IntNative", "UIntNative",
    "Bool", "Rune", "Unit", "Nothing", "This",
    "VArray", "String", "Array", "Option",
  ],

  constants: ["true", "false"],

  modifiers: [
    "public", "private", "protected", "open", "override", "abstract",
    "sealed", "const", "static", "internal", "external", "foreign",
    "unsafe", "mut",
  ],

  operators: [
    "=", ">", "<", "!", "~", "?", ":",
    "==", "<=", ">=", "!=", "&&", "||", "++", "--",
    "+", "-", "*", "/", "&", "|", "^", "%",
    "<<", ">>", "**", "=>",
    "+=", "-=", "*=", "/=", "&=", "|=", "^=", "%=",
    "<<=", ">>=",
  ],

  symbols: /[=><!~?:&|+\-*\/\^%]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      // decorators / annotations
      [/@[a-zA-Z_]\w*/, "annotation"],

      // identifiers and keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@typeKeywords": "type",
          "@constants": "constant",
          "@modifiers": "keyword.modifier",
          "@default": "identifier",
        },
      }],

      // whitespace
      { include: "@whitespace" },

      // delimiters and operators
      [/[{}()\[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],
      [/@symbols/, {
        cases: {
          "@operators": "operator",
          "@default": "",
        },
      }],

      // numbers
      [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/0[oO][0-7]+/, "number.octal"],
      [/0[bB][01]+/, "number.binary"],
      [/\d+/, "number"],

      // delimiter
      [/[;,.]/, "delimiter"],

      // strings
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

      // characters
      [/'[^\\']'/, "string"],
      [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
      [/'/, "string.invalid"],
    ],

    string: [
      [/[^\\"$]+/, "string"],
      [/\$\{/, { token: "delimiter.bracket", next: "@stringInterpolation" }],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],

    stringInterpolation: [
      [/\}/, { token: "delimiter.bracket", next: "@pop" }],
      { include: "root" },
    ],

    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],

    comment: [
      [/[^\/*]+/, "comment"],
      [/\/\*/, "comment", "@push"],
      ["\\*/", "comment", "@pop"],
      [/[\/*]/, "comment"],
    ],
  },
}

export function registerCangjieLanguage(monaco: typeof import("monaco-editor")) {
  monaco.languages.register({ id: cangjieLanguageId, extensions: [".cj"] })
  monaco.languages.setMonarchTokensProvider(cangjieLanguageId, cangjieMonarchLanguage)
  monaco.languages.setLanguageConfiguration(cangjieLanguageId, cangjieLanguageConfig)
}
