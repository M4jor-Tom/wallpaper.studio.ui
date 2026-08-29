{
  description = "wallpaper.studio.ui — browser editor for bgsvg configs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # A server and a window that die together: close the window and the
      # server stops, ^C and the window goes. Both editors want this, and they
      # differ only in what `serve` is -- the built binary, or cargo run over a
      # checkout.
      #
      # The window is surf: a bare WebKitGTK view, no tabs, no toolbar,
      # ~280 MiB. Telling surf the URL means pinning one first, hence the
      # fixed ports.
      windowed =
        pkgs:
        { name, port, serve }:
        if pkgs.stdenv.hostPlatform.isLinux then
          ''
            if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then
              # the probe cannot tell our server from anyone else's, so a port
              # already held would open a window onto it and wait
              echo "${name}: 127.0.0.1:${port} is already in use" >&2
              exit 1
            fi
            ${serve} &
            server=$!
            until (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; do
              kill -0 "$server" 2>/dev/null ||
                { echo "${name}: server exited before it was listening" >&2; exit 1; }
              sleep 0.1
            done
            ${pkgs.surf}/bin/surf 'http://127.0.0.1:${port}/' &
            window=$!
            # backgrounded so the shell waits in `wait`, where it still runs
            # traps: a foreground child defers them until it exits, which is
            # the one moment they are no use
            trap 'kill "$server" "$window" 2>/dev/null' EXIT INT TERM
            wait "$window"
          ''
        else
          ''
            # no window here: surf is X11/GTK, and nothing else is light
            echo "${name}: http://127.0.0.1:${port}/"
            exec ${serve}
          '';
    in
    {
      packages = forAll (
        pkgs:
        rec {
          # The editor: one binary carrying its own stylesheet and its own copy
          # of htmx, with the renderer linked in. No node_modules, no bundler,
          # nothing read from your working tree.
          server = pkgs.rustPlatform.buildRustPackage {
            pname = "wallpaper-studio-ui";
            version = "0.1.0";

            # only what cargo reads. target/ and result are working-tree
            # artefacts; letting them in would put the input hash at the mercy
            # of whatever was last built by hand.
            src = nixpkgs.lib.fileset.toSource {
              root = ./.;
              fileset = nixpkgs.lib.fileset.unions [
                ./Cargo.toml
                ./Cargo.lock
                ./src
                ./templates
                ./assets
              ];
            };

            cargoLock = {
              lockFile = ./Cargo.lock;
              # bgsvg is a git dependency, and cargo records no hash for one.
              # Refresh this after `cargo update -p bgsvg`; nix build prints
              # the value it wanted.
              outputHashes = {
                "bgsvg-0.1.0" = "sha256-zCIkT/HglLcCXIbHx2zC7pvgW17ysGrpU+ZcYoAYkDY=";
              };
            };

            # bgsvg's build.rs shells out to protoc
            nativeBuildInputs = [ pkgs.protobuf ];
            PROTOC = "${pkgs.protobuf}/bin/protoc";
          };

          default =
            let
              name = "wallpaper-studio-ui";
              # not 5173: an installed editor and a dev server should be able
              # to run at the same time
              port = "5174";
            in
            pkgs.writeShellApplication {
              inherit name;
              text = windowed pkgs {
                inherit name port;
                serve = "${server}/bin/wallpaper-studio-ui --port ${port}";
              };
            };
        }
      );

      apps = forAll (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          # `nix run .#dev` builds from your checkout rather than the store, so
          # a rebuild is a ^C and a rerun rather than a nix build.
          devServer =
            let
              name = "wallpaper-studio-ui-dev";
              port = "5173";
            in
            pkgs.writeShellApplication {
              inherit name;
              # stdenv.cc is the linker: packages.server gets one from stdenv,
              # a writeShellApplication does not, and without it cargo build
              # here dies with `linker `cc` not found` on any machine with no
              # system cc.
              runtimeInputs = [ pkgs.cargo pkgs.rustc pkgs.stdenv.cc pkgs.protobuf ];
              text = ''
                if [ ! -f Cargo.toml ]; then
                  echo "${name}: run this from the wallpaper.studio.ui checkout" >&2
                  exit 1
                fi
                export PROTOC="${pkgs.protobuf}/bin/protoc"
                cargo build
                ${windowed pkgs {
                  inherit name port;
                  serve = "cargo run --quiet -- --port ${port}";
                }}
              '';
            };
        in
        rec {
          wallpaper-studio-ui = {
            type = "app";
            program = nixpkgs.lib.getExe self.packages.${system}.default;
          };
          default = wallpaper-studio-ui;
          dev = {
            type = "app";
            program = nixpkgs.lib.getExe devServer;
          };
        }
      );

      # `nix flake check` on its own only evaluates the outputs -- it would pass
      # on a flake whose package does not build. Pointing it at the package
      # gives it something to realise: the server compiles and its tests run.
      checks = forAll (pkgs: { server = self.packages.${pkgs.stdenv.hostPlatform.system}.server; });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.cargo
            pkgs.rustc
            pkgs.clippy
            pkgs.rustfmt
            pkgs.protobuf
          ];
          PROTOC = "${pkgs.protobuf}/bin/protoc";
        };
      });
    };
}
