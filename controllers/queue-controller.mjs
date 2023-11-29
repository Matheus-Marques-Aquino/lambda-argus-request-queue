import axios from 'axios';
import dotenv from 'dotenv';

import { DateTime } from 'luxon';

import MongoConnection from '../configs/mongodb.js';

const mongo = new MongoConnection;

dotenv.config();

export default class ArgusQueueController {
    constructor() {

    }

    async argusImport(req) {
        //Retorna o horário de São Paulo
        const now = DateTime.now().setZone('America/Sao_Paulo');

        //Cria uma no hash de sessão
        var userId = mongo.generateUserId();

        //Verifica se o id/hash corresponde a alguma conexão com o banco
        var client = mongo.getClient(userId);

        if (client){
            //Reseta a conexão ao banco de dados caso ainda esteja conectado
            await mongo.disconnect(userId);
            await mongo.connect(userId);
        }else{
            //Cria uma nova conexão
            await mongo.connect(userId);
        }

        var {
            headers,
            body,
            ip,
            path,
            method,
            url
        } = req;

        //Armazena dados do request feito ao Argus
        const query = (url.query) ? '?' + url.query : '';

        const request = {
            userIp: ip,
            baseUrl: `${url.protocol}://${url.domain}${url.path}${query}`,
            path: path,
            method: method,
            headers: headers,
            body: body
        };

        if ((now.hour >= 20 && now.minute >= 30) || (now.hour <= 8)){
            //Verifica se esta dentro da faixa de horário para adicionar os requests a fila
            try{
                const RequestQueue = await mongo.getCollection(userId, 'RequestQueue');      
                
                //Adiciona ao banco o lead para ser processado posteriormente
                await RequestQueue.insertOne({ 
                    ...request,
                    timestamp: now.toISO(),
                    session: userId, 
                    sent: false, 
                    error: false 
                });            
            }catch(error){
                console.log(error);
            }

            //Desconecta do banco de dados e retorna mensagem de sucesso
            await mongo.disconnect(userId);

            return {
                status: 200,
                message: 'Lead adicionado a fila'
            };        
        }

        //Em caso de não estar dentro da faixa de horário realiza a requisição para o Argus
        var response = await this.argusRequest(
            path || '/',
            method || 'POST',
            headers, 
            body
        );

        //Armazeda dados da requisição e da resposta do Argus para serem inseridos no banco
        const payload = {
            request,
            response      
        };

        try{
            const ResponseList = await mongo.getCollection(userId, 'ResponseList');      
                
            //Adiciona os dados do lead ao banco como backup
            await ResponseList.insertOne({ 
                ...payload,
                timestamp: now.toISO(),
                session: userId, 
                sent: true, 
                error: false 
            });
        }catch(error){
            console.log(error);
        }

        //Desconecta do banco de dados, destroi a sessão e retorna a requisição + resposta
        mongo.disconnect(userId);

        return {
            status: 200,
            message: JSON.stringify(payload)
        }; 
    }

    async argusMassImport() {
        //Retorna o horário de São Paulo
        const now = DateTime.now().setZone('America/Sao_Paulo');
    
        //Variavel para armazenar o id da sessão
        var userId = mongo.generateUserId();
    
        //Verifica se o id/hash corresponde a alguma conexão com o banco
        var client = mongo.getClient(userId);
    
        if (client){
            //Reseta a conexão ao banco de dados caso ainda esteja conectado
            await mongo.disconnect(userId);
            await mongo.connect(userId);
        }else{
            //Cria uma nova conexão
            await mongo.connect(userId);
        }
    
        //Cria variavel para armazenar a lista com os leads da madrugada
        var leadList = [];
    
        try{
            const RequestQueue = await mongo.getCollection(userId, 'RequestQueue');
    
            const ResponseList = await mongo.getCollection(userId, 'ResponseList');
    
            //Recebe leads armazenados no banco
            leadList = await RequestQueue.find({ 'sent': false }).toArray();        
    
            var executeRequest = async (request) => {
                //Faz requisição para API do Argus
                var response = await this.argusRequest(
                    request.path || '/', 
                    request.method || 'POST', 
                    request.headers || {}, 
                    request.body || {}
                );
    
                //Armazena _id do documento
                var documentId = request._id;
    
                //Deleta _id do objeto request para ser armazedo de volta no banco posteriormente
                delete request._id;
            
                //Organiza dados para serem inseridos no banco de dados como backup
                var payload = {
                    request,
                    response      
                };
                
                await ResponseList.insertOne({ 
                    ...payload,
                    timestamp: now.toISO(),
                    session: userId, 
                    sent: true, 
                    error: false 
                });
    
                //Deleta documento da fila de requests para não ser processado novamente
                await RequestQueue.deleteOne({ "_id": documentId });
            }
    
            var waitBetweenRequest = async (ms) => {
                //Serve somente para dar tempo entre requisições feitas à API do Argus
                return new Promise((resolve, reject)=>{
                    setTimeout(resolve, ms);
                });
            }
    
            var requestLoop = async () => {
                if (leadList[0]){
                    //Executa requisição para API do Argus
                    await executeRequest(leadList[0]);
    
                    console.log(leadList[0]);
    
                    //Remove a requisição da lista
                    leadList.shift();
    
                    //Aguarda 500ms para executar próxima requisição
                    await waitBetweenRequest(500);
                    //Roda a função novamente até que leadList esteja vazia
                    await requestLoop();
                }
            }
    
            //Inicia o loop para fazer todas requisições
            await requestLoop();
    
        }catch(error){
            console.log(error);
        }
        
        //Desconecta do banco de dados, destroi a sessão
        mongo.disconnect(userId);
    
        return {
            status: 200,
            message: 'Leads importados'
        }; 
    }

    async argusRequest(url, method, headers, data){
        //Array com headers aceitos para serem enviados com a requisição para a API do Argus
        const enabledHeaders = [
            'authorization', 
            'content-type',
            'accept'
        ];
    
        //Objeto com os headers da requisição
        var requestReaders = {};
    
        for(let header in headers){
            let value = headers[header];        
            let key = header.toLowerCase();
            
            if (!enabledHeaders.includes(key)){
                //Caso não esteja entre os headers aceitos pula para próximo
                continue;
            }
        
            requestReaders[header] = value;
        }
    
        //Configura options do axios para fazer a requisição ao Argus
        const options = {
            baseURL: process.env.ARGUS_ENDPOINT,
            url: '/', //url,
            method,
            headers: { ...requestReaders },
            data
        };
    
        var response = {};
    
        try{
            await axios(options)
                .then((res)=>{
                    let {
                        headers,
                        data,
                        status                        
                    } = res;
    
                    //Formata resposta para trabalhar nas outras etapas
                    response = {
                        headers,
                        data,
                        status,
                        error: false
                    };
    
                    console.log('Resposta:', response);
                })
                .catch((err)=>{               
                    console.error('Erro Requisição:', err);
    
                    let {
                        code,
                        config
                    } = err;
    
                    if (!config){
                        config = {};
                    }
    
                    if (!err.response){
                        err.response = {};
                    }
    
                    let {
                        status,
                        statusText
                    } = err.response;
    
                    let {                  
                        headers,
                        method,
                        data
                    } = config;
    
                    method = method || "";
                    method = method.toString().toUpperCase();                
    
                    try{ 
                        //Em caso do error JSON.parse retornar erro não causa problemas ao código 
                        data = data || "{}";
                        data = JSON.parse(data); 
                    }catch(e){}                                
    
                    //Formata resposta para trabalhar nas outras etapas
                    response = {
                        code,
                        status,
                        headers: headers,
                        data: data,
                        error: true
                    }; 
    
                    console.log('Response:', response);
                });       
        }catch(err){
            console.error(err);
            response = err;
        }
    
        //Retorna resposta da requisição
        return response;
    }
}
