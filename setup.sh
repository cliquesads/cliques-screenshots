#!/bin/bash

# usage text visible when --help flag passed in
usage="$(basename "$0") -- Sets up all global packages necessary to deploy the adserver, including Node, PM2 & Redis using environment set in config/adserver.cfg.

where:
    --help  show this help text"

if [ ! -z $1 ]; then
  if [ $1 == '--help' ]; then
    echo "$usage"
    exit 0
  fi
fi

#system deps
sudo apt-get update
sudo apt-get install gcc make build-essential

folder_name=${PWD##*/}
#clone config repo and make symlink
# decide which config folder to use by checking current folder name
if [[ $folder_name == *"cliques"* ]]; then
  # for cliques-screenshots
  if [ ! -d $HOME"/repositories/cliques-config" ]; then
    git clone git@github.com:cliquesads/cliques-config.git ../cliques-config
    ln -s ../cliques-config config
  else
    cd ../cliques-config
    git pull
    cd ../cliques-screenshots
    ln -s ../cliques-config config
  fi
fi

if [[ $folder_name == *"smartertravel"* ]]; then
  # for smartertravel-screenshots
  if [ ! -d $HOME"/repositories/smartertravel-config" ]; then
    git clone git@github.com:cliquesads/smartertravel-config.git ../smartertravel-config
    ln -s ../smartertravel-config config
  else
    cd ../smartertravel-config
    git pull
    cd ../smartertravel-screenshots
    ln -s ../smartertravel-config config
  fi
fi


# Now get proper environment variables for global package versions, etc.
source ./config/environments/screenshot_environment.cfg

# Set up redis-server first
./setup-redis.sh

#download NVM and install NVM & node
if [[ $folder_name == *"cliques"* ]]; then
  curl https://raw.githubusercontent.com/creationix/nvm/v"$NVM_VERSION"/install.sh | NVM_DIR=$HOME/repositories/cliques-screenshots/.nvm bash
fi

if [[ $folder_name == *"smartertravel"* ]]; then
  curl https://raw.githubusercontent.com/creationix/nvm/v"$NVM_VERSION"/install.sh | NVM_DIR=$HOME/repositories/smartertravel-screenshots/.nvm bash
fi
source .nvm/nvm.sh
nvm install $NODE_VERSION

#install global node dependencies
npm update
#have to install pm2 & mocha globally into nvm dir
# TODO: If you need to revert to an older version of PM2 this won't work, b/c NVM global version defaults to most recent
# TODO: version.  Not an issue so long as you only ever use newer versions, but if you need to revert,
# TODO: you'll need to npm uninstall pm2 -g, which I don't want to do here so as to not interrupt running processes
# TODO: unnecessarily
npm install pm2@$PM2_VERSION -g
# update in-memory pm2 version
pm2 updatePM2
npm install mocha@$MOCHA_VERSION -g

exit 0
