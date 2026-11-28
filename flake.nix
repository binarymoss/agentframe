{
  description = "The open-source video editor for coding agents: create from scratch or edit existing footage";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      browser = "${pkgs.chromium}/bin/chromium";
      agentframe = pkgs.callPackage ./nix/package.nix {
        inherit browser;
        nodejs = pkgs.nodejs_26;
      };

      lint =
        pkgs.runCommand "agentframe-lint"
          {
            nativeBuildInputs = [ pkgs.biome ];
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [
                ./src
                ./test
                ./package.json
                ./tsconfig.json
                ./AGENTS.md
                ./README.md
                ./skills
                ./biome.json
              ];
            };
          }
          ''
            cd "$src"
            biome format .
            biome lint .
            touch "$out"
          '';
      tests = nodejs: (agentframe.override { inherit nodejs; }).overrideAttrs (old: {
        pname = "agentframe-tests-node-${nodejs.version}";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [
            ./src
            ./test
            ./package.json
            ./pnpm-lock.yaml
            ./tsconfig.json
          ];
        };
        nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.ffmpeg ];
        AGENTFRAME_BROWSER_PATH = browser;
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          ${nodejs}/bin/node node_modules/typescript/bin/tsc --noEmit
          ${nodejs}/bin/node --test --test-concurrency=1
          runHook postCheck
        '';
        installPhase = "touch \"$out\"";
      });
    in
    {
      packages.${system} = {
        inherit agentframe;
        default = agentframe;
      };
      formatter.${system} = pkgs.nixfmt-tree;
      checks.${system} = {
        inherit lint;
        node22 = tests pkgs.nodejs_22;
        node24 = tests pkgs.nodejs_24;
        node26 = tests pkgs.nodejs_26;
      };
      apps.${system}.agentframe = {
        type = "app";
        program = "${agentframe}/bin/agentframe";
      };
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_26
          pnpm
          ffmpeg
          chromium
          biome
        ];
        AGENTFRAME_BROWSER_PATH = browser;
      };
    };
}
