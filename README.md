# cliques-screenshots
Cliques Screenshots contains a nodejs app that subscribe to captureScreenshot message from Google pubsub service, and whenever the message received, capture a screenshot from the requested website.

## Folder structure

	.
	├── README.md - documentation
	├── bq_config.json
	├── bq_config_dev.json
	├── config -> ../cliques-config - config folder
	├── index.js - app main entry
	├── lib
	│   ├── logger.js - app logger
	│   └── screenshots_logging.js - screenshot logging functionalities
	├── package.json - dependencies
	├── screenshots - the folder where screenshot images saved
	├── services
	│   └── crawler.js - the phantomjs screenshot rendering service
	└── setup.sh - shell script to set up app

## Setup & Dependencies
Key dependency is Redis v2.8 or greater. To install & run redis (current version 3.0.1), run:
```
$./setup_redis.sh
```
To set up a new machine (Debian or Ubuntu) for the first time, run:
```
$./setup.sh
```

## Deployment
Once your machine is all setup and Redis is running, you can deploy:
```
$ git pull
$ ./deploy_screenshots.sh
```

