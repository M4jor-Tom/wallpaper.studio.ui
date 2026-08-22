{
  description = "svg.studio.ui — browser editor for bgsvg configs (toolchain, plus the renderer it consumes)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # The renderer, pinned by flake.lock. The .wasm, its generated .d.ts and
    # descriptor.bin must all come from ONE revision: tools/drift.ts compares
    # the descriptor against src/schema.ts, and a descriptor from a different
    # revision than the module was built from proves nothing. The lockfile is
    # what guarantees that: package.json's `types` script vendors the .d.ts,
    # the .js and the .wasm into vendor/, but only ever out of the BGSVG_WASM
    # this shell exports, so vendor/ cannot come from a revision the lock does
    # not name.
    #
    # Changes upstream reach this repository only once pushed; adopt them with
    #   nix flake update svg_builder
    # For co-development against a local working tree, without touching the lock:
    #   nix develop --override-input svg_builder path:../svg_builder
    svg_builder.url = "git+ssh://git@github.com/M4jor-Tom/theta_svg_builder.py.git";
    svg_builder.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, svg_builder }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # `nix run` starts the editor. It runs against your checkout rather than a
      # built derivation, deliberately: vite needs node_modules and the module
      # vendored into vendor/, neither of which lives in the store, and
      # packaging bun's dependency tree for Nix buys nothing while that tree is
      # vite plus typescript. So this is the README's three commands in one,
      # not a sandboxed build.
      apps = forAll (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          ui = pkgs.writeShellApplication {
            name = "svg-studio-ui";
            runtimeInputs = [ pkgs.bun ];
            text = ''
              if [ ! -f package.json ] || [ ! -f vite.config.ts ]; then
                echo "svg-studio-ui: run this from the svg.studio.ui checkout" >&2
                exit 1
              fi
              # the same locked revision the devShell exports, so `nix run` and
              # `nix develop` can never render through different modules
              export BGSVG_WASM="${svg_builder.packages.${system}.bgsvg-wasm}"
              [ -d node_modules ] || bun install
              bun run types
              exec bun run dev "$@"
            '';
          };
        in
        rec {
          svg-studio-ui = {
            type = "app";
            program = "${ui}/bin/svg-studio-ui";
          };
          default = svg-studio-ui;
        }
      );

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          # bun is runtime, package manager and TypeScript execution in one
          # binary; vite runs under it, since it is the better-proven path for
          # loading a WASM module and for HMR.
          #
          # bgsvg is here for `bgsvg --descriptor`, which feeds tools/drift.ts.
          # It does not render anything at development time -- the browser does
          # that, through the WASM module.
          packages = [
            pkgs.bun
            svg_builder.packages.${pkgs.stdenv.hostPlatform.system}.default
          ];

          # the browser-callable module, from the same locked revision as the
          # bgsvg binary above -- vite.config.ts resolves the @bgsvg alias to it
          BGSVG_WASM = svg_builder.packages.${pkgs.stdenv.hostPlatform.system}.bgsvg-wasm;
        };
      });
    };
}
