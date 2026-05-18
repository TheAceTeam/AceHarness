/*
 * Language: Cangjie
 */

function source(re: RegExp | string) {
  if (!re) return null;
  if (typeof re === 'string') return re;
  return re.source;
}

function concat(...args: Array<RegExp | string>) {
  return args.map((item) => source(item)).join('');
}

function either(...args: Array<RegExp | string>) {
  return `(?:${args.map((item) => source(item)).join('|')})`;
}

function lookahead(re: RegExp | string) {
  return concat('(?=', re, ')');
}

function cangjie(hljs: any) {
  const IDENTIFIER_HEAD = /[A-Za-z_\u00C0-\u9FFF]/;
  const IDENTIFIER_CHAR = /[0-9A-Za-z_\u00C0-\u9FFF]/;
  const IDENTIFIER = concat(IDENTIFIER_HEAD, IDENTIFIER_CHAR, '*');
  const BACKTICK_IDENTIFIER = concat(/`/, IDENTIFIER, /`/);
  const ANY_IDENTIFIER = either(BACKTICK_IDENTIFIER, IDENTIFIER);
  const TYPE_IDENTIFIER = concat(/[A-Z]/, IDENTIFIER_CHAR, '*');
  const NUMBER_SUFFIX = /(?:u8|u16|u32|u64|i8|i16|i32|i64|f16|f32|f64)\??/;

  const KEYWORDS = [
    'as', 'abstract', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'do', 'else', 'enum', 'extend', 'for', 'from', 'func', 'finally', 'foreign',
    'if', 'in', 'is', 'init', 'import', 'interface', 'let', 'mut', 'main', 'macro',
    'match', 'open', 'operator', 'override', 'prop', 'public', 'internal', 'package',
    'private', 'protected', 'quote', 'redef', 'return', 'sealed', 'spawn', 'super',
    'static', 'struct', 'synchronized', 'try', 'this', 'type', 'throw', 'unsafe',
    'var', 'where', 'while'
  ];

  const LITERALS = ['true', 'false'];
  const BUILT_IN_TYPES = [
    'Bool', 'Rune', 'Float16', 'Float32', 'Float64', 'Int8', 'Int16', 'Int32', 'Int64',
    'IntNative', 'Nothing', 'This', 'Unit', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
    'UIntNative', 'VArray'
  ];

  const COMMENTS = [
    hljs.C_LINE_COMMENT_MODE,
    hljs.COMMENT('/\\*', '\\*/', { contains: ['self'] })
  ];

  const NUMBER = {
    className: 'number',
    relevance: 0,
    variants: [
      { match: concat(/\b0x[0-9A-Fa-f_]+/, lookahead(either(NUMBER_SUFFIX, /\b/))) },
      { match: concat(/\b0o[0-7_]+/, lookahead(either(NUMBER_SUFFIX, /\b/))) },
      { match: concat(/\b0b[01_]+/, lookahead(either(NUMBER_SUFFIX, /\b/))) },
      { match: concat(/\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eEpP][+-]?\d[\d_]*)?/, lookahead(either(NUMBER_SUFFIX, /\b/))) },
      { match: concat(/\B\.\d[\d_]*(?:[eEpP][+-]?\d[\d_]*)?/, lookahead(either(NUMBER_SUFFIX, /\b/))) }
    ]
  };

  const INTERPOLATION = {
    className: 'subst',
    begin: /\$\{/,
    end: /\}/,
    keywords: {
      keyword: KEYWORDS.join(' '),
      literal: LITERALS.join(' '),
      built_in: BUILT_IN_TYPES.join(' ')
    },
    contains: [] as any[]
  };

  const STRING = {
    className: 'string',
    variants: [
      {
        begin: /"""/,
        end: /"""/,
        contains: [hljs.BACKSLASH_ESCAPE, INTERPOLATION]
      },
      {
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE, INTERPOLATION]
      },
      {
        begin: /'/,
        end: /'/,
        contains: [hljs.BACKSLASH_ESCAPE]
      }
    ]
  };

  INTERPOLATION.contains = [
    ...COMMENTS,
    NUMBER,
    STRING,
    {
      className: 'keyword',
      match: concat(/\b/, either(...KEYWORDS), /\b/)
    },
    {
      className: 'built_in',
      match: concat(/\b/, either(...BUILT_IN_TYPES), /\b/)
    },
    {
      className: 'title.function',
      match: concat(ANY_IDENTIFIER, lookahead(/\s*\(/))
    },
    {
      className: 'variable',
      match: ANY_IDENTIFIER
    }
  ];

  const TYPE: any = {
    className: 'type',
    relevance: 0,
    variants: [
      { match: concat(/\b/, either(...BUILT_IN_TYPES), /\b/) },
      { match: concat(/\b/, TYPE_IDENTIFIER, /\b/) }
    ]
  };

  const ANNOTATION = {
    className: 'meta',
    match: concat(/@/, ANY_IDENTIFIER)
  };

  const FUNCTION_NAME = {
    className: 'title.function',
    relevance: 0,
    variants: [
      {
        match: concat(/\bfunc\s+/, ANY_IDENTIFIER),
        scope: { 1: 'keyword', 2: 'title.function' }
      },
      {
        match: concat(/\b/, ANY_IDENTIFIER, lookahead(/\s*\(/))
      }
    ]
  };

  const TYPE_DECLARATION = {
    relevance: 0,
    variants: [
      {
        match: concat(/\b(?:class|interface|enum|struct|extend|type)\s+/, ANY_IDENTIFIER),
        scope: { 1: 'keyword', 2: 'title.class' }
      }
    ]
  };

  const VARIABLE_DECLARATION = {
    relevance: 0,
    variants: [
      {
        match: concat(/\b(?:let|var|const|prop)\s+/, ANY_IDENTIFIER),
        scope: { 1: 'keyword', 2: 'variable' }
      }
    ]
  };

  const IMPORT_LIKE = {
    className: 'keyword',
    relevance: 0,
    match: concat(/\b(?:package|import|from|as)\b/)
  };

  const GENERICS = {
    begin: /</,
    end: />/,
    relevance: 0,
    keywords: {
      keyword: KEYWORDS.join(' '),
      literal: LITERALS.join(' '),
      built_in: BUILT_IN_TYPES.join(' ')
    },
    contains: [
      ...COMMENTS,
      TYPE,
      NUMBER,
      STRING,
      ANNOTATION,
      {
        className: 'keyword',
        match: concat(/\b/, either(...KEYWORDS), /\b/)
      },
      {
        className: 'punctuation',
        match: /,/,
        relevance: 0
      }
    ]
  };

  TYPE.contains = [GENERICS];

  return {
    name: 'Cangjie',
    aliases: ['cj'],
    keywords: {
      keyword: KEYWORDS.join(' '),
      literal: LITERALS.join(' '),
      built_in: BUILT_IN_TYPES.join(' ')
    },
    illegal: /<\//,
    contains: [
      ...COMMENTS,
      NUMBER,
      STRING,
      ANNOTATION,
      TYPE_DECLARATION,
      VARIABLE_DECLARATION,
      FUNCTION_NAME,
      IMPORT_LIKE,
      TYPE,
      {
        className: 'symbol',
        match: /'[A-Za-z_][A-Za-z0-9_]*/
      },
      {
        className: 'operator',
        relevance: 0,
        match: /\|>|~>|->|=>|==|!=|<=|>=|&&|\|\||<<|>>|[+\-*/%&|^~!=<>?:]+/
      },
      {
        className: 'punctuation',
        relevance: 0,
        match: /[{}()[\],.;]/
      }
    ]
  };
}

export default cangjie;
