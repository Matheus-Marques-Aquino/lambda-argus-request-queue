import ArgusQueueController from './controllers/queue-controller.mjs';

const queue = new ArgusQueueController();

const methodList = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'OPTIONS',
    'HEAD'
];

const protocolList = [
    'http',
    'https'
];

export const handler = async (event, context) => {

    var {
        rawPath: path,
        rawQueryString: query,
        queryStringParameters: params,
        headers,
        body,
        requestContext
    } = event;


    headers = { ...headers };

    if (body){
        try {
            body = JSON.parse(body);
            body = { ...body };
        } catch (error) {
            console.error(error);
            body = {};
        }
    }else{
        body = {};
    }


    var {
        "x-forwarded-proto": protocol
    } = headers;

    if (!protocol || !protocolList.includes(protocol)) {
        protocol = 'https';
    }

    requestContext = { ...requestContext };

    var {
        domainName: domain,
        http
    } = requestContext;

    domain = (domain) ? domain : '';
    http = { ...http };

    var {
        method,
        sourceIp: ip
    } = http;

    if (!method || !methodList.includes(method)) {
        method = 'POST';
    }

    var request = {
        headers,
        body,
        ip,
        url: {
            protocol,
            domain,
            path,
            query
        },
        path,
        method,
    };

    if (path && path.includes('import-queue')){
        console.log('Iniciando importação!');

        let leads = await queue.argusMassImport();

        const response = {
            statusCode: 200,
            body: { ...leads }
        };    
    
        return response;
    }

    var lead = await queue.argusImport(request);    

    const response = {
        statusCode: 200,
        body: { ...lead }
    };    

    return response;
};
