{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.ottie;
in
{
  imports = [
    (lib.mkRenamedOptionModule [ "services" "ottie" "allowedHosts" ] [ "services" "ottie" "hostnames" ])
  ];

  options.services.ottie = {
    enable = lib.mkEnableOption "Ottie, a self-hosted daemon for AI coding agents";

    package = lib.mkPackageOption pkgs "ottie" { };

    user = lib.mkOption {
      type = lib.types.str;
      default = "ottie";
      description = "User account under which Ottie runs.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "ottie";
      description = "Group under which Ottie runs.";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default =
        if cfg.user == "ottie"
        then "/var/lib/ottie"
        else "/home/${cfg.user}/.ottie";
      defaultText = lib.literalExpression ''
        if cfg.user == "ottie"
        then "/var/lib/ottie"
        else "/home/''${cfg.user}/.ottie"
      '';
      description = "Directory for Ottie state (OTTIE_HOME). Stores agent data, config, and logs.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 6767;
      description = "Port for the Ottie daemon to listen on.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address for the Ottie daemon to bind to.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the firewall for the Ottie daemon port.";
    };

    hostnames = lib.mkOption {
      type = lib.types.either (lib.types.enum [ true ]) (lib.types.listOf lib.types.str);
      default = [ ];
      example = [ ".example.com" "myhost.local" ];
      description = ''
        Hostnames the Ottie daemon accepts in the Host header (DNS rebinding protection).
        Localhost and IP addresses are always allowed by default.

        Use a leading dot to match a domain and all its subdomains
        (e.g. `".example.com"` matches `example.com` and `foo.example.com`).

        Set to `true` to allow any host (not recommended).
      '';
    };

    relay = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to enable the relay connection for remote access via app.ottie.app.";
      };
    };

    inheritUserEnvironment = lib.mkOption {
      type = lib.types.bool;
      default = cfg.user != "ottie";
      defaultText = lib.literalExpression ''cfg.user != "ottie"'';
      description = ''
        Whether to include the user's profile PATH in the service environment.

        When Ottie runs as a real user (not the default system user), AI agents
        need access to the user's tools (git, ssh, etc.). This adds the user's
        NixOS profile and system paths so agents can use them without manually
        setting PATH.

        Enabled by default when `user` is set to a non-default value.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = lib.literalExpression ''
        {
          OTTIE_RELAY_ENDPOINT = "relay.ottie.app:443";
        }
      '';
      description = "Extra environment variables for the Ottie daemon.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.${cfg.user} = lib.mkIf (cfg.user == "ottie") {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.dataDir;
    };

    users.groups.${cfg.group} = lib.mkIf (cfg.group == "ottie") { };

    systemd.tmpfiles.rules = [
      "d ${cfg.dataDir} 0700 ${cfg.user} ${cfg.group} - -"
    ];

    systemd.services.ottie = {
      description = "Ottie - self-hosted daemon for AI coding agents";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        NODE_ENV = "production";
        OTTIE_HOME = cfg.dataDir;
        OTTIE_LISTEN = "${cfg.listenAddress}:${toString cfg.port}";
      } // lib.optionalAttrs cfg.inheritUserEnvironment {
        # mkForce overrides the default PATH from NixOS's systemd module (which
        # only includes store paths for coreutils/grep/sed/systemd). Our PATH
        # includes /run/current-system/sw/bin which is a superset of those.
        PATH = lib.mkForce (lib.concatStringsSep ":" [
          "/etc/profiles/per-user/${cfg.user}/bin"
          "/run/current-system/sw/bin"
          "/run/wrappers/bin"
          "/nix/var/nix/profiles/default/bin"
        ]);
      } // lib.optionalAttrs (cfg.hostnames == true) {
        OTTIE_HOSTNAMES = "true";
      } // lib.optionalAttrs (lib.isList cfg.hostnames && cfg.hostnames != [ ]) {
        OTTIE_HOSTNAMES = lib.concatStringsSep "," cfg.hostnames;
      } // cfg.environment;

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;

        ExecStart =
          "${cfg.package}/bin/ottie-server"
          + lib.optionalString (!cfg.relay.enable) " --no-relay";

        Restart = "on-failure";
        RestartSec = 5;

        # Graceful shutdown (server handles SIGTERM with a 10s timeout)
        KillSignal = "SIGTERM";
        TimeoutStopSec = 15;
      };
    };

    environment.systemPackages = [ cfg.package ];

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
