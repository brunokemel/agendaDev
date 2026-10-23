# agendaDev

Aplicativo local e offline para transformar arquivos `.txt` em uma agenda visual inspirada no Microsoft OneNote. O sistema organiza notas em cadernos, secoes e paginas, oferece pesquisa, links clicaveis, relatorios e persistencia em JSON.

## Requisitos

- Windows, Linux ou macOS para executar em modo navegador.
- Python 3.10 ou superior.
- Python e `pip` disponiveis no `PATH`.
- Internet apenas durante a instalacao das dependencias. O aplicativo nao precisa de internet depois de iniciado.

## Executar em desenvolvimento

Na raiz do projeto:

```bash
pip install -r requirements.txt
python run.py
```

Abra `http://127.0.0.1:5055` no navegador. Para encerrar, volte ao terminal e pressione `Ctrl+C`.

No Windows, tambem e possivel usar [Agenda.bat](Agenda.bat), que inicia o aplicativo com a configuracao padrao.

## Gerar o executavel

### Windows

O caminho recomendado e executar [build.bat](build.bat) na raiz do projeto:

```powershell
cd C:\caminho\para\AgendaOneNote
.\build.bat
```

O script instala as dependencias e executa o PyInstaller usando [agenda.spec](agenda.spec). O resultado sera:

```text
dist\AgendaOneNote.exe
```

Se o comando `pyinstaller` nao estiver no `PATH`, use o modulo pelo Python instalado:

```powershell
python -m PyInstaller --noconfirm --clean agenda.spec
```

Para gerar uma copia com outro nome na Area de Trabalho:

```powershell
Copy-Item .\dist\AgendaOneNote.exe "$HOME\Desktop\agendaKemel.exe" -Force
```

### Linux e macOS

```bash
pip install -r requirements.txt
bash build.sh
```

O executavel sera criado em `dist/AgendaOneNote`.

### Rebuild limpo

Quando houver alteracoes em templates, arquivos estaticos ou na configuracao do empacotamento, remova os artefatos anteriores antes de compilar novamente:

```powershell
Remove-Item -Recurse -Force .\build, .\dist
python -m PyInstaller --noconfirm --clean agenda.spec
```

## Importar arquivos `.txt`

Coloque os arquivos em `data/entrada_txt`. O aplicativo le automaticamente os arquivos `.txt` dessa pasta e de suas subpastas ao iniciar. O mesmo arquivo nao e duplicado em cada abertura.

Para importar arquivos novos ou alterados sem reiniciar, use **Atualizar interface**. Cada nova versao e importada uma unica vez.

No executavel do Windows, os dados ficam em:

```text
%LocalAppData%\AgendaOneNote\data\entrada_txt
```

Os dados persistentes ficam em `data/notes.json`, `data/notebooks.json` e, para imagens e documentos futuros, em `data/assets/`. Relatorios e backups podem ser gerados pela propria aplicacao.

Imagens inseridas nas notas podem ser arrastadas entre os blocos, aumentadas ou reduzidas, alinhadas e recortadas visualmente por proporcao, zoom e ponto de foco. O recorte e reversivel e nao modifica o arquivo original. O botao **Modo escuro/Modo claro** fica visivel na barra superior e guarda a preferencia localmente.

No editor, o botao **Modo livre** transforma a nota em um quadro: clique em um espaco vazio para criar texto naquele ponto; clique no texto para editar ou segure e mova para arrastar; imagens tambem podem ser seguradas diretamente. Use **Organizar** para retornar ao fluxo vertical; as coordenadas ficam guardadas para quando o modo livre for aberto novamente.

Na lateral **Links da nota**, use **+ Link** para informar o endereco e um nome de exibicao (mascara). Por exemplo, `https://exemplo.com/manual` pode aparecer no texto apenas como `Manual`. Use **Ctrl + clique** sobre o nome para abrir o endereco no navegador.

## Backup completo e restauracao

No aplicativo instalado, abra **Relatorios** e use **Exportar backup completo**. Escolha uma pasta de destino; o aplicativo criara nela uma subpasta com data e hora contendo notas, cadernos, assets, o registro de importacoes e os arquivos de `entrada_txt`. O manifesto do backup inclui hashes para detectar arquivos alterados ou corrompidos.

Depois de instalar uma nova versao, abra **Relatorios**, clique em **Restaurar pasta de backup** e selecione a subpasta criada na exportacao. O conteudo atual sera substituido somente depois que o backup for validado. Antes da restauracao, o aplicativo cria automaticamente uma copia da agenda atual em:

```text
%LocalAppData%\AgendaOneNote\backups_antes_de_restaurar
```

O formato atual de backup e a versao 2. Backups antigos da versao 1 continuam aceitos.

## Formato do arquivo `.txt`

Separe notas com uma linha contendo `---`. Os cabecalhos sao opcionais:

```text
TITULO: Reuniao
IMPORTANCIA: urgente
TAGS: trabalho, produto
CADERNO: Trabalho
SECAO: Reunioes
DATA: 04/09/2026 09:00
PRAZO: 05/09/2026

Texto da nota com https://exemplo.com e email@dominio.com
```

Niveis de importancia aceitos: `urgente`, `alta`, `media` e `baixa`. Tambem sao aceitos `high`, `low`, `[urgente]` e `!!!`.

## Recursos

- Visualizacao em cards com faixa de importancia.
- Pesquisa em tempo real no titulo, conteudo, tags e nome do arquivo.
- Links e e-mails clicaveis no editor.
- Criacao de cadernos, secoes e paginas dentro do app.
- Relatorios em HTML/TXT e persistencia em JSON.
- Escolha do formato de exportacao: no executavel, abre a janela **Salvar como** do Windows; no navegador, usa o download normal.

## Atalhos

- `Ctrl+N`: nova pagina.
- `Ctrl+S`: salvar.
- `Ctrl+K`: abrir a paleta para localizar paginas e executar acoes.
- `Esc`: fechar painel.

A barra lateral organiza paginas por caderno e secao, mostra recentes e favoritos e pode ser recolhida ou redimensionada. No editor, **Pagina mae** cria uma hierarquia de subpaginas; alterar Caderno ou Secao move a pagina.

O editor usa blocos de texto, títulos, listas, checklist, citação e divisor. Digite `/` em um bloco vazio para escolher o tipo, use os controles laterais para reordenar e `Ctrl+Z`/`Ctrl+Y` para desfazer ou refazer. As alterações são salvas automaticamente e o estado aparece no topo do editor.

Imagens podem ser coladas com `Ctrl+V`, arrastadas para o editor ou escolhidas pelo botão **Imagem**. PNG, JPEG, WebP e GIF de até 8 MB são validados, deduplicados e armazenados somente na pasta local `data/assets`. O botão de lua/sol na barra roxa alterna entre os temas claro e escuro e guarda a preferência neste computador.

## Testes

Execute os testes automatizados com:

```bash
python -m pytest
```

## Seguranca e versionamento

Os arquivos em `data/entrada_txt` podem conter senhas, acessos, e-mails ou outras informacoes pessoais. Eles sao ignorados pelo Git por padrao. Revise tambem os arquivos JSON antes de publica-los, pois eles podem conter o conteudo das notas.

O arquivo `.gitignore` mantem fora do repositorio caches, ambientes virtuais, artefatos do PyInstaller e os `.txt` pessoais importados.
