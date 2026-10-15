import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateUploadDto, CreateUploadResponseDto, FileDto } from './dto/files.dto';
import { FilesService } from './files.service';

@ApiTags('Files')
@Controller('files')
@Auth()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiOperation({
    summary: '1) Request an upload URL',
    description: [
      'Validates purpose, type and size, and returns where to send the file. The file goes',
      'DIRECTLY to the storage (S3) — never through the API. Then the client:',
      '',
      '```js',
      'const form = new FormData();',
      'Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));',
      "form.append('file', file); // ALWAYS last",
      'await fetch(upload.url, { method: "POST", body: form });',
      '```',
      '',
      'and confirms with `POST /files/:id/complete`.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: CreateUploadResponseDto })
  @ApiErrors([400, 'Type not allowed for the purpose, or file too large'])
  create(@CurrentUser('id') userId: string, @Body() dto: CreateUploadDto) {
    return this.files.create(userId, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '3) Confirm the upload',
    description:
      'Checks that the file arrived, its real size and its content (the first bytes must match the declared type). Invalid files are discarded.',
  })
  @ApiOkResponse({ type: FileDto })
  @ApiErrors(
    [400, 'File not uploaded yet, or content does not match the type'],
    [404, 'File not found'],
  )
  complete(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.complete(userId, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a file (with its URL)',
    description: 'Private files come with a temporary signed download URL (5 min).',
  })
  @ApiOkResponse({ type: FileDto })
  @ApiErrors([404, 'File not found'])
  get(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.get(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file' })
  @ApiNoContentResponse()
  @ApiErrors([404, 'File not found'])
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.files.remove(userId, id);
  }
}
