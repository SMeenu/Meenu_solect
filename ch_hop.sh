f_tout () {
        $1 &
        sleep $2
        kill $!
}

echo "... Creating required directories and files"

sed s/'"channel": [0-9]*'/'"channel":11'/ < /etc/solectria/network/network_config.json 1> /etc/solectria/network/network_config.json 2>logs/err
systemctl restart solectria_network_daemon.service && echo "Channel changed"
