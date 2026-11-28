{
  description = "The open-source video editor for coding agents: create from scratch or edit existing footage";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      browser = "${pkgs.chromium}/bin/chromium";
      agentframe = pkgs.callPackage ./nix/package.nix { inherit browser; };

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
      tests = agentframe.overrideAttrs (old: {
        pname = "agentframe-tests";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [
            ./src
            ./test
            ./package.json
            ./pnpm-lock.yaml
          ];
        };
        nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.ffmpeg ];
        AGENTFRAME_BROWSER_PATH = browser;
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          pnpm test
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
      checks.${system} = { inherit lint tests; };
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
