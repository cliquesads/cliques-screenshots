#!/bin/bash

# usage text visible when --help flag passed in
usage="$(basename "$0") -- deploy the Cliques Screenshots

where:
    --help  show this help text
    -e arg (='production') environment flag - either 'dev' or 'production'.  Defaults to production"

# BEGIN environment parsing
env="production"

if [ ! -z $1 ]; then
  if [ $1 == '--help' ]; then
    echo "$usage"
    exit 0
  fi
fi

# fucking getopts
while getopts ":e:" opt; do
  case $opt in
    e)
      if [ "$OPTARG" != 'production' ] && [ "$OPTARG" != 'dev' ]; then
        echo "Invalid environment: $OPTARG.  Environment must be either 'dev' or 'production'"
        exit 1
      else
        env="$OPTARG"
      fi
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      echo "$usage"
      exit 1
      ;;
    :)
      echo "Environment flag -$OPTARG requires an argument (either 'dev' or 'production')" >&2
      exit 1
      ;;
  esac
done
# END environment parsing

# Set proper environment variables now that env is set
folder_name=${PWD##*/}
if [ "$env" == "production" ]; then
    processname=$folder_name
else
    processname=$folder_name"_dev"
fi

source activate_env.sh -e $env
# if activate_env failed then bail
if [ $? -ne 0 ]; then
    exit $?
fi

# Need to be logged into to get @cliques packages
npm whoami
if [ $? -ne 0 ]; then
    npm login
fi
# run npm install to install any new dependencies
npm install

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
  fi
fi

running=$(pm2 list -m | grep "$processname")

if [ -z "$running" ]; then
    # hook PM2 up to web monitoring with KeyMetrics
    pm2 link $KEYMETRICS_PRIVATE_KEY $KEYMETRICS_PUBLIC_KEY $HOSTNAME
    # start in cluster mode
    pm2 start index.js --name "$processname" -i 0
else
    pm2 stop "$processname"
    pm2 start "$processname"
fi
