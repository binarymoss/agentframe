{
  lib,
  stdenvNoCC,
  nodejs_26,
  pnpm,
  pnpmConfigHook,
  fetchPnpmDeps,
  makeWrapper,
  ffmpeg,
  browser,
}:

stdenvNoCC.mkDerivation (rec {
  pname = "agentframe";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../src
      ../skills
      ../package.json
      ../pnpm-lock.yaml
    ];
  };
  nativeBuildInputs = [
    nodejs_26
    pnpm
    pnpmConfigHook
    makeWrapper
  ];
  pnpmDeps = fetchPnpmDeps {
    inherit
      pname
      version
      src
      pnpm
      ;
    fetcherVersion = 4;
    hash = "sha256-yhiSmUc4JNHYjPR9fPD22NKp/P432lZ7NOEjN681zYI=";
  };
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/agentframe" "$out/bin"
    cp -r src package.json node_modules "$out/lib/agentframe/"
    install -Dm644 skills/agentframe/SKILL.md "$out/share/agentframe/skills/agentframe/SKILL.md"
    makeWrapper ${nodejs_26}/bin/node "$out/bin/agentframe" \
      --add-flags "$out/lib/agentframe/src/cli.ts" \
      --prefix PATH : ${lib.makeBinPath [ ffmpeg ]} \
      --set AGENTFRAME_BROWSER_PATH ${browser}
    runHook postInstall
  '';
  meta.mainProgram = "agentframe";
})
