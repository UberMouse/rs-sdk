{
  description = "rs-sdk dev shell";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          # bun runs everything here (sdk, bots, engine, gateway, lite client).
          # Upstream CI pins 1.3.14; stable's 1.3.13 is the nearest nixpkgs has.
          packages = [ pkgs.bun ];
          # puppeteer is only a devDependency, and the Chrome it downloads
          # can't run on NixOS; browser clients open in the system browser.
          PUPPETEER_SKIP_DOWNLOAD = "1";
        };
      });
}
