'use strict';

/* eslint-disable security/detect-object-injection */

/**
 * Module dependencies, required for ALL Twyr' modules
 * @ignore
 */

/**
 * Module dependencies, required for this module
 * @ignore
 */
const TwyrBaseService = require('/home/kaushik/source/twyr-webapp-server/framework/twyr-base-service').TwyrBaseService;
const TwyrSrvcError = require('/home/kaushik/source/twyr-webapp-server/framework/twyr-service-error').TwyrServiceError;

/**
 * @class   RingpopService
 * @extends {TwyrBaseService}
 * @classdesc The Twyr Web Application Server Ringpop Service.
 *
 * @description
 * Allows the rest of the Twyr Modules to use Ringpop SDK API.
 *
 */
class RingpopService extends TwyrBaseService {
	// #region Constructor
	constructor(parent, loader) {
		super(parent, loader);
	}
	// #endregion

	// #region startup/teardown code
	/**
	 * @async
	 * @function
	 * @override
	 * @instance
	 * @memberof RingpopService
	 * @name     _setup
	 *
	 * @returns  {null} Nothing.
	 *
	 * @summary  Sets up the connection to the Ringpop SDK.
	 */
	async _setup() {
		try {
			await super._setup();

			const Promise = require('bluebird');
			const TChannel = require('tchannel');
			const Ringpop = require('ringpop');

			const self = this; // eslint-disable-line consistent-this
			const loggerProxy = {
				'log': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.log)
						return;

					self.$dependencies.LoggerService.log(...arguments);
				},
				'trace': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.silly)
						return;

					self.$dependencies.LoggerService.silly(...arguments);
				},
				'silly': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.silly)
						return;

					self.$dependencies.LoggerService.silly(...arguments);
				},

				'debug': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.debug)
						return;

					self.$dependencies.LoggerService.debug(...arguments);
				},

				'verbose': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.verbose)
						return;

					self.$dependencies.LoggerService.verbose(...arguments);
				},

				'info': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.info)
						return;

					self.$dependencies.LoggerService.info(...arguments);
				},

				'warn': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.warn)
						return;

					self.$dependencies.LoggerService.warn(...arguments);
				},

				'error': function() {
					if(!self.$dependencies.LoggerService)
						return;

					if(!self.$dependencies.LoggerService.error)
						return;

					self.$dependencies.LoggerService.error(...arguments);
				}
			};

			if(!this.$config.host) {
				const networkInterfaceList = require('os').networkInterfaces();
				let hosts = null;

				Object.keys(networkInterfaceList).forEach((networkInterface) => {
					const interfaceAddresses = networkInterfaceList[networkInterface].filter((address) => {
						if(address.internal)
							return false;

						if(address.family.toLowerCase() !== 'ipv4')
							return false;

						return true;
					});

					if(!interfaceAddresses.length)
						return;

					hosts = interfaceAddresses.map((interfaceAddress) => {
						return interfaceAddress.address;
					});
				});

				this.$config.port = Number(this.$config.port);
				if(hosts.length === 1)
					this.$config.host = hosts[0];
				else
					throw new Error(`Multiple possible IPv4 addresses for clustering: ${JSON.stringify(hosts)}`);
			}

			return new Promise((resolve, reject) => {
				try {
					const tchannel = new TChannel({
						'statTags': {
							'app': this.$parent.$application,
							'cluster': process.title
						},

						'logger': loggerProxy,
						'trace': (twyrEnv === 'development' || twyrEnv === 'test')
					});

					const subChannel = tchannel.makeSubChannel({
						'serviceName': 'ringpop',
						'trace': (twyrEnv === 'development' || twyrEnv === 'test')
					});

					const ringpop = new Ringpop({
						'app': this.$parent.$application,
						'hostPort': `${this.$config.host}:${this.$config.port}`,
						'channel': subChannel,

                        'joinSize': 1,
						'joinTimeout': 100,

                        'logger': loggerProxy
					});

					ringpop.appChannel = tchannel.makeSubChannel({
						'serviceName': process.title
					});

					ringpop.setupChannel();
					tchannel.listen(this.$config.port, this.$config.host, () => {
						ringpop.bootstrap({
							'joinParallelismFactor': 2,
							'hosts': (this.$config.bootstrapNodes && this.$config.bootstrapNodes.length) ? this.$config.bootstrapNodes : [`${this.$config.host}:${this.$config.port}`]
						}, (err) => {
							if(err) {
								this.onRingpopError(err);
								reject(err);

								return;
							}

							this.$ringpop = ringpop;
							this.$ringpop.on('ringChanged', this.onRingChanged.bind(this));
							this.$ringpop.on('error', this.onRingpopError.bind(this));

							this.$parent.once('server-online', this._printInformation.bind(this));
							resolve();

							return;
						});
					});
				}
				catch(err) {
					reject(new TwyrSrvcError(`${this.name}::_setup::inner error`, err));
				}
			});
		}
		catch(err) {
			throw new TwyrSrvcError(`${this.name}::_setup::outer error`, err);
		}
	}

	/**
	 * @async
	 * @function
	 * @override
	 * @instance
	 * @memberof RingpopService
	 * @name     _teardown
	 *
	 * @returns  {undefined} Nothing.
	 *
	 * @summary  Quits the connection to the Ringpop SDK.
	 */
	async _teardown() {
		if(!this.$ringpop)
			return null;

		try {
			this.$ringpop.off('error', this.onRingpopError.bind(this));
			this.$ringpop.off('ringChanged', this.onRingChanged.bind(this));

			this.$ringpop.destroy();
			delete this.$ringpop;

			await super._teardown();
			return null;
		}
		catch(err) {
			throw new TwyrSrvcError(`${this.name}::_teardown error`, err);
		}
	}
	// #endregion

	// #region Private Methods
	async _printInformation() {
		if((twyrEnv !== 'development') && (twyrEnv !== 'test'))
			return;

		await snooze(600);
		this.$dependencies.LoggerService.debug(`Ringpop cluster initialized at ${this.$ringpop.whoami()}`);
	}

	async onRingChanged(event) {
		const ringpop = this.$ringpop;
		const leader = ringpop.lookup('LEADER');
		if(leader !== ringpop.whoami())
			return;

		const loggerService = this.$dependencies.LoggerService;
		const mailerService = this.$dependencies.MailerService;

		const mailOptions = {
			'from': 'root@twyr.io',
			'to': 'shadyvd@hotmail.com',
			'subject': 'Twyr Web Application Server Ring Changed',
			'text': `Added Servers: ${JSON.stringify((event.added || []), null, '\t')}\n\nRemoved Servers: ${JSON.stringify((event.removed || []), null, '\t')}`
		};

		const mailInfo = await mailerService.sendMailAsync(mailOptions);
		loggerService.info(`Ring Changed:\nAdded Servers: ${JSON.stringify((event.added || []), null, '\t')}\n\nRemoved Servers: ${JSON.stringify((event.removed || []), null, '\t')}\nEmail Sent: ${JSON.stringify(mailInfo, null, '\t')}`);
	}

	async onRingpopError(error) {
		if(!(error instanceof TwyrSrvcError)) error = new TwyrSrvcError(`${this.name}::_setup::ringpop bootstrap error`, error);

		const ringpop = this.$ringpop;
		const leader = ringpop.lookup('LEADER');
		if(leader !== ringpop.whoami())
			return;

		const loggerService = this.$dependencies.LoggerService;
		const mailerService = this.$dependencies.MailerService;

		const mailOptions = {
			'from': 'root@twyr.io',
			'to': 'shadyvd@hotmail.com',
			'subject': 'Twyr Web Application Server Ringpop Error',
			'text': `Ringpop Error:\n${error.toString()}`
		};

		const mailInfo = await mailerService.sendMailAsync(mailOptions);
		loggerService.error(`Ringpop Error: ${error.toString()}\nEmail Sent: ${JSON.stringify(mailInfo, null, '\t')}`);
	}
	// #endregion

	// #region Properties
	/**
	 * @override
	 */
	get Interface() {
		return this.$ringpop;
	}

	/**
	 * @override
	 */
	get dependencies() {
		return ['ConfigurationService', 'LoggerService', 'MailerService'].concat(super.dependencies);
	}

	/**
	 * @override
	 */
	get basePath() {
		return __dirname;
	}
	// #endregion
}

exports.service = RingpopService;
