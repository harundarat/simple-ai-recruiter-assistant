import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class EvaluateRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  job_title!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cv_id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  project_report_id!: number;
}
