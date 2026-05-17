# Clever — guia de instalação no Windows (passo a passo)

Este guia é para instalar e rodar o sistema **do zero**, no Windows, sem
precisar entender de programação. Siga os passos **na ordem**, um de cada vez.

Para o que cada arquivo faz e como o sistema funcionam por dentro, veja o
`CLAUDE.md`. Aqui o foco é só **instalar e ligar**.

---

## O que você vai instalar

São 3 programas + este projeto. Todos são gratuitos.

| Programa  | Para quê serve                                  |
|-----------|-------------------------------------------------|
| Node.js   | roda o proxy e abre as janelas do Chrome        |
| Python    | é o programa principal que liga tudo (`run.py`) |
| Caddy     | cuida da parte de segurança (HTTPS) das páginas |
| Chrome    | o navegador onde os anúncios aparecem           |

---

## Passo 1 — Instalar o Node.js

1. Abra o site **https://nodejs.org**
2. Clique no botão grande que diz **"LTS"** (versão recomendada).
3. Abra o arquivo baixado e clique **Next / Avançar** em todas as telas,
   sem mudar nada, até **Finish / Concluir**.

> ⚠️ Se aparecer uma caixa **"Automatically install the necessary tools"**
> (instalar ferramentas automaticamente), pode deixar **marcada** e continuar.

---

## Passo 2 — Instalar o Python

1. Abra o site **https://www.python.org/downloads/**
2. Clique no botão amarelo **"Download Python"**.
3. Abra o arquivo baixado. **MUITO IMPORTANTE:** na primeira tela, marque a
   caixinha embaixo escrito **"Add Python to PATH"** (Adicionar Python ao PATH).
   Sem isso o sistema não funciona.
4. Clique em **"Install Now"** e espere terminar. Clique **Close**.

---

## Passo 3 — Instalar o Caddy

1. Abra o **menu Iniciar**, digite `cmd`, e abra o **Prompt de Comando**.
2. Copie e cole a linha abaixo e aperte **Enter**:

   ```
   winget install CaddyServer.Caddy
   ```

3. Se ele perguntar algo, digite `S` ou `Y` e aperte **Enter**. Espere terminar.

> Se o comando `winget` não for reconhecido, atualize a "App Installer" pela
> Microsoft Store e tente de novo.

---

## Passo 4 — Instalar o Google Chrome

Se ainda não tiver, instale pelo site **https://www.google.com/chrome**.

> ⚠️ **Não use o navegador Brave** — ele bloqueia os anúncios da Clever.

---

## Passo 5 — Reiniciar o computador

Depois de instalar tudo, **reinicie o Windows**. Isso garante que o Node e o
Python passem a ser reconhecidos pelo sistema.

---

## Passo 6 — Preparar o projeto (só uma vez)

1. Coloque a pasta do projeto (`clever`) em um lugar fácil, por exemplo na
   **Área de Trabalho**.
2. Abra a pasta `clever`.
3. Na barra de endereço da janela da pasta (onde aparece o caminho), clique,
   apague tudo, digite `cmd` e aperte **Enter**. Isso abre o Prompt de Comando
   **já dentro da pasta certa**.
4. Copie e cole a linha abaixo e aperte **Enter**:

   ```
   npm install
   ```

5. Espere terminar (pode demorar alguns minutos — ele baixa o Chrome de teste).
   Quando o cursor voltar a piscar, está pronto. Pode fechar essa janela.

> Esse passo só precisa ser feito **uma vez**. Nas próximas vezes, vá direto
> para o Passo 7.

---

## Passo 7 — Rodar o sistema com o watchdog

O **watchdog** é o jeito recomendado de rodar: ele liga o sistema e, se algo
travar ou cair, **religa sozinho automaticamente**.

### 7.1 — Abrir o PowerShell como Administrador

Isso é **obrigatório** (o sistema precisa mexer em configurações protegidas
do Windows).

1. Abra o **menu Iniciar** e digite `powershell`.
2. Na opção **"Windows PowerShell"**, clique com o **botão direito** do mouse.
3. Escolha **"Executar como administrador"**.
4. Se aparecer uma janela perguntando se permite alterações, clique **Sim**.

### 7.2 — Entrar na pasta do projeto

Na janela azul do PowerShell, digite `cd `, **arraste a pasta `clever`**
para dentro da janela (o caminho aparece sozinho) e aperte **Enter**.

Exemplo de como deve ficar:

```
cd C:\Users\SeuNome\Desktop\clever
```

### 7.3 — Ligar o watchdog

Digite a linha abaixo e aperte **Enter**:

```
.\watchdog.ps1
```

> **Se aparecer um erro vermelho** dizendo que a execução de scripts está
> desabilitada, rode **uma vez** o comando abaixo e depois tente o
> `.\watchdog.ps1` de novo:
>
> ```
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> (digite `S` e Enter se ele perguntar)

Pronto! O sistema vai subir e, em alguns segundos, **janelas do Chrome vão
abrir sozinhas** com os sites e os anúncios. Pode deixar o computador ligado e
trabalhando.

---

## Como parar

Clique na janela do PowerShell e aperte **Ctrl + C**.
Isso encerra o watchdog e fecha tudo na ordem (Chrome, Caddy e proxy).

---

## Variações (opcional)

Você pode passar uma palavra depois do comando, conforme a necessidade:

```
.\watchdog.ps1 static     # as janelas NÃO recarregam (útil para testar clique)
.\watchdog.ps1 win        # usa só os perfis de navegador "Windows"
```

---

## Se algo der errado

| Problema                                            | O que fazer                                                                 |
|-----------------------------------------------------|------------------------------------------------------------------------------|
| `python não é reconhecido`                          | Reinstale o Python marcando **"Add Python to PATH"** (Passo 2) e reinicie.    |
| `node não encontrado`                               | Reinstale o Node.js (Passo 1) e reinicie o computador.                        |
| `caddy não encontrado`                              | Refaça o Passo 3.                                                             |
| `dependências não instaladas`                       | Você pulou o Passo 6 — rode `npm install` na pasta do projeto.                |
| `porta 443 ocupada` / `caddy não subiu`             | Confirme que abriu o PowerShell **como Administrador** (Passo 7.1).           |
| Erro vermelho sobre "scripts desabilitados"         | Rode o comando `Set-ExecutionPolicy` indicado no Passo 7.3.                   |
| Os anúncios não aparecem                            | Confirme que está usando o **Chrome** (não o Brave).                          |

Se o watchdog mostrar mensagens amarelas dizendo que o `run.py` saiu e está
**relançando** — isso é normal, é a função dele. Só se preocupe se ele ficar
relançando sem parar e nenhuma janela do Chrome abrir.
