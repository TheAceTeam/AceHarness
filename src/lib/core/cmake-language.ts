import type { languages } from "monaco-editor"

export const cmakeLanguageId = "cmake"

export const cmakeLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "#",
  },
  brackets: [
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
}

export const cmakeMonarchLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".cmake",
  ignoreCase: true,

  keywords: [
    "add_compile_definitions", "add_compile_options", "add_custom_command",
    "add_custom_target", "add_definitions", "add_dependencies",
    "add_executable", "add_library", "add_link_options",
    "add_subdirectory", "add_test", "aux_source_directory",
    "break", "build_command", "cmake_host_system_information",
    "cmake_minimum_required", "cmake_parse_arguments", "cmake_path",
    "cmake_policy", "configure_file", "continue",
    "create_test_sourcelist", "define_property",
    "else", "elseif", "enable_language", "enable_testing",
    "endforeach", "endfunction", "endif", "endmacro", "endwhile",
    "execute_process", "export",
    "file", "find_file", "find_library", "find_package",
    "find_path", "find_program", "foreach", "function",
    "get_cmake_property", "get_directory_property",
    "get_filename_component", "get_property", "get_target_property",
    "if", "include", "include_directories", "include_guard",
    "install", "link_directories", "link_libraries",
    "list", "macro", "mark_as_advanced", "math", "message",
    "option", "project", "return",
    "separate_arguments", "set", "set_directory_properties",
    "set_property", "set_target_properties", "site_name",
    "source_group", "string", "target_compile_definitions",
    "target_compile_features", "target_compile_options",
    "target_include_directories", "target_link_directories",
    "target_link_libraries", "target_link_options",
    "target_precompile_headers", "target_sources",
    "try_compile", "try_run", "unset", "variable_watch", "while",
  ],

  constants: [
    "TRUE", "FALSE", "ON", "OFF", "YES", "NO",
    "AND", "OR", "NOT", "COMMAND", "POLICY", "TARGET", "TEST",
    "DEFINED", "EXISTS", "IS_DIRECTORY", "IS_ABSOLUTE",
    "MATCHES", "LESS", "GREATER", "EQUAL", "STRLESS", "STRGREATER",
    "STREQUAL", "VERSION_LESS", "VERSION_GREATER", "VERSION_EQUAL",
  ],

  operators: ["AND", "OR", "NOT"],

  tokenizer: {
    root: [
      // comments
      [/#.*$/, "comment"],

      // variables ${...} and $ENV{...}
      [/\$\{/, { token: "variable", next: "@variable" }],
      [/\$ENV\{/, { token: "variable", next: "@variable" }],
      [/\$CACHE\{/, { token: "variable", next: "@variable" }],

      // generator expressions $<...>
      [/\$</, { token: "annotation", next: "@generator" }],

      // strings
      [/"/, { token: "string.quote", next: "@string" }],

      // commands and keywords
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@constants": "constant",
          "@default": "identifier",
        },
      }],

      // numbers
      [/\d+(\.\d+)?/, "number"],

      // brackets
      [/[()]/, "@brackets"],

      // whitespace
      [/[ \t\r\n]+/, "white"],
    ],

    variable: [
      [/[^}]+/, "variable"],
      [/\}/, { token: "variable", next: "@pop" }],
    ],

    generator: [
      [/[^>]+/, "annotation"],
      [/>/, { token: "annotation", next: "@pop" }],
    ],

    string: [
      [/\$\{/, { token: "variable", next: "@variable" }],
      [/\$ENV\{/, { token: "variable", next: "@variable" }],
      [/[^"$]+/, "string"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],
  },
}

export function registerCMakeLanguage(monaco: typeof import("monaco-editor")) {
  monaco.languages.register({ id: cmakeLanguageId, extensions: [".cmake"], filenames: ["CMakeLists.txt"] })
  monaco.languages.setMonarchTokensProvider(cmakeLanguageId, cmakeMonarchLanguage)
  monaco.languages.setLanguageConfiguration(cmakeLanguageId, cmakeLanguageConfig)
}
